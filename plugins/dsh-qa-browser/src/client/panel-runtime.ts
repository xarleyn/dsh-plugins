/**
 * The small facts the panel's runtime needs that are nobody else's: how a
 * remote answer is unwrapped, who this panel is to the host, how fast to poll,
 * and how a key press is named for the transport.
 */
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { KeyboardEvent } from "react";

/**
 * A tab the agent is working through is worth watching closely, and a human who
 * holds the lease expects their own clicks to show up promptly; an idle preview
 * is not worth a screenshot every second.
 */
export const POLL_ACTIVE_MS = 1_000;
/**
 * Idle panels poll slowly: the frame itself is fetched only when the tab
 * revision changes (a ~0.5 MB PNG per poll is not a heartbeat), so the idle
 * poll only costs one small panelState call. A real screencast channel is
 * the structural fix and stays a SPEC non-goal for this release.
 */
export const POLL_IDLE_MS = 5_000;

export function remoteValue<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

export function makeClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function keyboardShortcut(event: KeyboardEvent<HTMLElement>): string {
  const modifiers = [
    event.ctrlKey ? "Control" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.metaKey ? "Meta" : null,
  ].filter((value): value is string => value !== null);
  return [...modifiers, event.key].join("+");
}
