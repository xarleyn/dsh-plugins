/**
 * Host half of the durable session events (SPEC §28).
 *
 * The payload contract lives in `src/shared/session-events.ts` so the browser
 * card can inline it; what lives here is what only the Host can do: append to
 * a Session, and keep the two types inside the harness's live vocabulary.
 */

import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import { JEV_COMPACTION_SESSION_EVENTS } from "../shared/session-events.js";
import type {
  JevCompactionAppliedEventData,
  JevCompactionSkippedEventData,
} from "../shared/session-events.js";

export {
  JEV_COMPACTION_APPLIED_EVENT,
  JEV_COMPACTION_SESSION_EVENTS,
  JEV_COMPACTION_SKIPPED_EVENT,
} from "../shared/session-events.js";
export type {
  JevCompactionAppliedEventData,
  JevCompactionItemAction,
  JevCompactionItemRecord,
  JevCompactionRunMode,
  JevCompactionSkippedEventData,
  JevCompactionTrigger,
  JevSkipReason,
} from "../shared/session-events.js";

/**
 * Declare the two event types into the harness's own vocabulary.
 *
 * The alternative — casting at the append site — would leave the payload
 * untyped everywhere it is read, which is exactly where a drift would hide.
 * Declaring it here keeps `session.append` and every reader checked against
 * one contract. The declaration is type-level only: the harness's runtime
 * surface, request-header and message-projection logic is driven by its own
 * sets, and neither of these types is in any of them, so both stay log-only.
 */
declare module "@deepseek-ai/dsh-session/types" {
  interface SessionEventMap {
    "jev-compaction/applied": JevCompactionAppliedEventData;
    "jev-compaction/skipped": JevCompactionSkippedEventData;
  }
}

/**
 * Join this plugin's event types into the harness's live vocabulary.
 *
 * These types are outside the harness's own `SessionEventMap` build, so a log
 * containing them is — for a reader that does not have this plugin loaded — a
 * required-event refusal rather than a silently skipped one. Registering them
 * while the plugin is mounted is what makes such a log interpretable; the
 * persistence read path resolves the set through the single
 * `@deepseek-ai/dsh-session` module instance the host also loads.
 * `dsh-session-scope` uses the same mechanism for `session-scope/set`.
 *
 * @returns a disposer that removes exactly what this call added.
 */
export function registerJevCompactionSessionEventTypes(): () => void {
  const known = KNOWN_SESSION_EVENT_TYPES as Set<string>;
  const added: string[] = [];
  for (const type of JEV_COMPACTION_SESSION_EVENTS) {
    if (known.has(type)) continue;
    known.add(type);
    added.push(type);
  }
  return () => {
    for (const type of added) known.delete(type);
  };
}
