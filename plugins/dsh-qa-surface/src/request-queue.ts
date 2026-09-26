import type { Agent } from "@deepseek-ai/dsh-agent";
import type { QaQueueStatus } from "./types.js";

/**
 * Chat turns the stand is answering right now.
 *
 * `running` is the harness's own definition of an active request: an agent
 * enters it when waking input starts the driver and leaves it when the driver
 * retires, which is what `agent/status` reports. Reading the live agents rather
 * than counting the plugin's own sends is what keeps the places honest — a
 * browser that closes mid-answer, an answer started through the HTTP API and a
 * turn resumed by another surface all occupy a place, and none of them has to
 * report it here. Only top-level agents count: a delegated expert's requests
 * belong to the chat turn that delegated them, so charging both would bill one
 * conversation twice.
 *
 * The count is of the model's load, not of this plugin's traffic: a turn the
 * native assistant runs occupies a place exactly like a QA question does,
 * because the ceiling exists for the card that is busy either way.
 */
export function qaActiveRequests(
  agents: readonly { readonly status: Agent["status"] }[],
): number {
  return agents.filter((agent) => agent.status === "running").length;
}

/**
 * Judge the live count against the deployment's ceiling. A ceiling of 0 sets no
 * limit, so the stand is never full and nobody waits.
 *
 * There is deliberately no "ahead of you" number: `active` includes this
 * visitor's own turns, and a stand that cannot say which place belongs to whom
 * should not pretend to know who is waiting behind whom.
 */
export function qaQueueStatus(limit: number, active: number): QaQueueStatus {
  return Object.freeze({ limit, active, full: limit > 0 && active >= limit });
}
