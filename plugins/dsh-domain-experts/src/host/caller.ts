import type { Agent } from "@deepseek-ai/dsh-agent";
import { DomainExpertsError } from "./errors.js";
import type { RunTracker, SubagentsFace } from "./execution.js";
import { DOMAIN_ID_PATTERN } from "../types.js";

const EXPERT_LABEL_PREFIX = "domain-expert:";

/** Creation label persisted by the Host in its parent-owned child catalog. */
export function expertLabelOf(domainId: string): string {
  return `${EXPERT_LABEL_PREFIX}${domainId}`;
}

/**
 * Attribute a caller without accepting identity from tool arguments.
 *
 * The live tracker is authoritative. After eviction or restart, the Host's
 * durable direct-child catalog supplies the creation label. Only a positively
 * identified ordinary child may fall back to root policy; unreadable catalogs
 * and absent rows are unknown identities, never unrestricted callers.
 * This recovers delegation identity only, not an account's memory ownership.
 */
export async function callerDomainOf(
  tracker: RunTracker,
  subagents: SubagentsFace,
  agent: Agent,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  const header = agent.session.header;
  const tracked = tracker.find(String(header.id));
  if (tracked !== undefined) return tracked.domainId;
  if (header.origin !== "subagent") return null;
  if (header.parentSession === undefined || subagents.childrenOf === undefined)
    throw unknownCaller();

  // Forward cancellation to the catalog and bound the wait as well, so a
  // stalled provider cannot start a late run after the tool has been cancelled.
  const lookupSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  try {
    const rows = await withSignal(
      subagents.childrenOf(String(header.parentSession), lookupSignal),
      lookupSignal,
    );
    signal.throwIfAborted();
    const matches = rows.filter((row) => row.sessionId === String(header.id));
    if (matches.length !== 1) throw unknownCaller();
    const row = matches[0]!;
    if (!row.label?.startsWith(EXPERT_LABEL_PREFIX)) return null;
    const domainId = row.label.slice(EXPERT_LABEL_PREFIX.length);
    if (!DOMAIN_ID_PATTERN.test(domainId)) throw unknownCaller();
    return domainId;
  } catch {
    signal.throwIfAborted();
    throw unknownCaller();
  }
}

function unknownCaller(): DomainExpertsError {
  return new DomainExpertsError(
    "EXPERT_NOT_CALLER",
    "The Host cannot verify which domain governs this subagent. Start the request from a chat, or restore its parent-owned child catalog before delegating.",
  );
}

async function withSignal<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason as unknown);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
