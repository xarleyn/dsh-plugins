import { IntegrationError } from "../errors.js";
import type { ServiceRateLimitConfig } from "./types.js";

const MINUTE_MS = 60_000;

/**
 * Buckets are only kept while a limit bites, so this is a safety valve for a
 * deployment with far more principals than expected rather than a working set
 * size. An entry whose balance is full again costs nothing to forget.
 */
const MAX_TRACKED_KEYS = 4096;

/** Refill is float arithmetic; a balance is "full" within this much. */
const REFILL_EPSILON = 1e-9;

interface Balance {
  /** Requests left, as a fraction of a request. */
  tokens: number;
  /** Timestamp the balance was last moved. */
  at: number;
}

export interface ServiceCallKeys {
  readonly principal: string;
  readonly provider: string;
  /** The managed credential the call spends: the shared side of the limit. */
  readonly profileId: string;
}

/** Which ceiling refused, for the operator-facing log line only. */
export type ServiceRateLimitReason = "principal" | "concurrency" | "credential";

export class ServiceRateLimitError extends IntegrationError {
  constructor(readonly reason: ServiceRateLimitReason) {
    super(
      "RateLimited",
      "Too many requests through the service credential. Try again later.",
    );
    this.name = "IntegrationError";
  }
}

/**
 * Refill-on-read limiting of service-mode calls.
 *
 * A managed credential is one upstream identity shared by every user of the
 * deployment, so the ceiling that protects it has to be two-sided at once: one
 * principal must not exhaust the shared quota, and the shared quota must not be
 * multiplied per principal. Both buckets are therefore read before either is
 * written — a call refused by the shared ceiling leaves the individual balance
 * untouched and one refused by the individual ceiling leaves the shared balance
 * untouched. Otherwise a noisy user would pay for the bottleneck they create
 * with everybody else's allowance.
 *
 * A bucket holds `requestsPerMinute` tokens and refills at that rate, so the
 * allowance is spent continuously rather than reset on a wall-clock minute: a
 * burst may take a full minute of requests and is then throttled to the steady
 * rate. A rate of `0` disables that dimension.
 *
 * State lives in this process only, which is where the only path to a managed
 * credential lives.
 */
export class ServiceRateLimiter {
  private readonly principals = new Map<string, Balance>();
  private readonly credentials = new Map<string, Balance>();
  private readonly inflight = new Map<string, number>();
  private readonly maxTrackedKeys: number;
  private config: ServiceRateLimitConfig;

  constructor(
    config: ServiceRateLimitConfig,
    private readonly now: () => number = () => Date.now(),
    options: { readonly maxTrackedKeys?: number } = {},
  ) {
    this.config = config;
    this.maxTrackedKeys = options.maxTrackedKeys ?? MAX_TRACKED_KEYS;
  }

  /**
   * Take in new operator values. Balances survive: re-tuning a limit must not
   * hand a fresh minute of requests to everyone at once.
   */
  configure(config: ServiceRateLimitConfig): void {
    this.config = config;
  }

  /**
   * Spend one request or refuse it. The returned function gives the concurrency
   * slot back and is safe to call more than once, because the caller releases it
   * from a `finally` that may have run already.
   */
  acquire(keys: ServiceCallKeys): () => void {
    const { perPrincipal, perCredential } = this.config;
    const now = this.now();
    const principalKey = `${keys.provider}\u0000${keys.principal}`;
    const principal = available(
      this.principals.get(principalKey),
      perPrincipal.requestsPerMinute,
      now,
    );
    const credential = available(
      this.credentials.get(keys.profileId),
      perCredential.requestsPerMinute,
      now,
    );
    const active = this.inflight.get(keys.profileId) ?? 0;
    const ceiling = perCredential.maxConcurrent;

    if (principal < 1) throw new ServiceRateLimitError("principal");
    if (active >= ceiling && ceiling > 0) {
      throw new ServiceRateLimitError("concurrency");
    }
    if (credential < 1) throw new ServiceRateLimitError("credential");

    this.spend(
      this.principals,
      principalKey,
      perPrincipal.requestsPerMinute,
      now,
      principal,
    );
    this.spend(
      this.credentials,
      keys.profileId,
      perCredential.requestsPerMinute,
      now,
      credential,
    );
    this.inflight.set(keys.profileId, active + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.inflight.get(keys.profileId) ?? 1) - 1;
      if (left <= 0) this.inflight.delete(keys.profileId);
      else this.inflight.set(keys.profileId, left);
    };
  }

  private spend(
    map: Map<string, Balance>,
    key: string,
    rate: number,
    now: number,
    from: number,
  ): void {
    if (rate <= 0) return;
    if (!map.has(key) && map.size >= this.maxTrackedKeys) {
      this.retire(map, rate, now);
    }
    map.set(key, { tokens: from - 1, at: now });
  }

  /**
   * Free room for a new principal. A stored balance only refills when it is
   * read, so "idle" is measured against now rather than against what is in the
   * entry: a bucket that has earned its whole allowance back is equivalent to
   * an absent one, and forgetting it costs nobody anything. If every entry is
   * still spending, the longest untouched one goes.
   */
  private retire(map: Map<string, Balance>, rate: number, now: number): void {
    for (const [key, balance] of map) {
      if (available(balance, rate, now) >= rate - REFILL_EPSILON) {
        map.delete(key);
      }
    }
    if (map.size < this.maxTrackedKeys) return;
    let oldest: string | undefined;
    let at = Number.POSITIVE_INFINITY;
    for (const [key, balance] of map) {
      if (balance.at < at) {
        at = balance.at;
        oldest = key;
      }
    }
    if (oldest !== undefined) map.delete(oldest);
  }
}

function available(
  bucket: Balance | undefined,
  rate: number,
  now: number,
): number {
  if (rate <= 0) return Number.POSITIVE_INFINITY;
  if (bucket === undefined) return rate;
  const elapsed = Math.max(0, now - bucket.at);
  return Math.min(rate, bucket.tokens + (elapsed * rate) / MINUTE_MS);
}
