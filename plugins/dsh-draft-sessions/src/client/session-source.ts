import type {
  SessionListState,
  SessionReferenceSource,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";

declare module "@deepseek-ai/dsh-api-session-controller/client" {
  interface SessionReferenceSourceMap {
    /** The draft composer owns the Session shell of the draft it mirrors. */
    draftComposer: unknown;
  }
}

export const DRAFT_COMPOSER_SOURCE =
  "draftComposer" satisfies SessionReferenceSource;

/**
 * The Session this plugin currently holds. `rc.2` deleted the Host-wide
 * `SessionListState.current` and moved selection into the views that retain a
 * Session, so the retained row of our own source is what stands in for it.
 */
export function retainedDraftSessionId(
  state: Pick<SessionListState, "byId">,
): SessionId | undefined {
  for (const summary of Object.values(state.byId)) {
    if ((summary.retainedBy[DRAFT_COMPOSER_SOURCE] ?? 0) > 0) {
      return summary.id;
    }
  }
  return undefined;
}
