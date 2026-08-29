/**
 * Persistence circuit breaker (SPEC §33).
 *
 * When llama slot persistence is broken, retrying it on every request would
 * waste seconds each time. After N consecutive persistence failures the
 * breaker opens for a cooldown; while open, requests pass straight through
 * to ordinary inference (which stays active). After the cooldown one probe
 * attempt is allowed (half-open).
 */

export type CircuitState = "healthy" | "degraded" | "open" | "half-open";

export interface CircuitBreakerOptions {
  readonly maxConsecutiveFailures: number;
  readonly cooldownMs: number;
}

export class CircuitBreaker {
  readonly #maxConsecutiveFailures: number;
  readonly #cooldownMs: number;
  #consecutiveFailures = 0;
  #openUntil = 0;
  #state: CircuitState = "healthy";

  constructor(options: CircuitBreakerOptions) {
    this.#maxConsecutiveFailures = options.maxConsecutiveFailures;
    this.#cooldownMs = options.cooldownMs;
  }

  get state(): CircuitState {
    return this.#state;
  }

  get consecutiveFailures(): number {
    return this.#consecutiveFailures;
  }

  /** True when a persistence operation may be attempted at `now`. */
  allows(now: number): boolean {
    if (this.#state === "open") {
      if (now < this.#openUntil) return false;
      this.#state = "half-open";
      return true;
    }
    return true;
  }

  /** Whether persistence is currently skipped entirely (open without probe). */
  isOpen(now: number): boolean {
    return this.#state === "open" && now < this.#openUntil;
  }

  recordSuccess(): void {
    this.#consecutiveFailures = 0;
    if (this.#state !== "healthy") this.#state = "healthy";
  }

  recordFailure(now: number): void {
    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= this.#maxConsecutiveFailures) {
      this.#state = "open";
      this.#openUntil = now + this.#cooldownMs;
    } else if (this.#state === "healthy") {
      this.#state = "degraded";
    }
  }

  /** Manual recovery hook (e.g. a successful probe). */
  reset(): void {
    this.#consecutiveFailures = 0;
    this.#openUntil = 0;
    this.#state = "healthy";
  }
}
