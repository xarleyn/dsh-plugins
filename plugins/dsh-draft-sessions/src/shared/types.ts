import {
  DEFAULT_TITLE_MAX_LENGTH,
  DRAFT_FILE_VERSION,
  DRAFT_SESSION_VERSION,
} from "./constants.js";

export type DraftSessionState =
  "draft" | "materializing" | "ready" | "converting" | "error";

/** Host-backed authority for one unsent future conversation. */
export interface DraftSession {
  readonly version: typeof DRAFT_SESSION_VERSION;
  readonly id: string;
  readonly sessionId: string | null;
  readonly workspaceId: string;
  readonly workspacePath?: string;
  readonly text: string;
  /** Explicit user title. Consumers derive a title from text when absent. */
  readonly title?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly order: number;
  readonly pinned?: boolean;
  readonly agentPresetId?: string;
  readonly state: DraftSessionState;
  readonly lastError?: string;
  /** Optimistic concurrency token, incremented after every mutation. */
  readonly revision: number;
}

export interface DraftFile {
  readonly version: typeof DRAFT_FILE_VERSION;
  readonly drafts: readonly DraftSession[];
}

export interface ListDraftsRequest {
  readonly workspaceId?: string;
}

export interface CreateDraftRequest {
  readonly workspaceId: string;
  readonly sessionId?: string | null;
  readonly workspacePath?: string;
  readonly text?: string;
  readonly title?: string;
  readonly order?: number;
  readonly pinned?: boolean;
  readonly agentPresetId?: string;
}

export interface UpdateDraftRequest {
  readonly id: string;
  readonly expectedRevision: number;
  readonly text?: string;
  /** `null` removes an explicit title and returns to first-line derivation. */
  readonly title?: string | null;
  readonly order?: number;
  readonly pinned?: boolean;
  /** `null` clears the preset binding. */
  readonly agentPresetId?: string | null;
  readonly state?: DraftSessionState;
  /** `null` clears the last materialization error. */
  readonly lastError?: string | null;
}

export interface DeleteDraftRequest {
  readonly id: string;
  readonly expectedRevision?: number;
}

export interface DeleteDraftResult {
  readonly deleted: boolean;
}

export interface RebindDraftRequest {
  readonly id: string;
  readonly expectedRevision: number;
  readonly sessionId: string | null;
}

/** First non-empty line, compacted for a session-like sidebar row. */
export function deriveDraftTitle(
  text: string,
  maxLength = DEFAULT_TITLE_MAX_LENGTH,
): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) {
    throw new RangeError("maxLength must be a positive safe integer");
  }
  const firstLine = text.trim().split(/\r?\n/u, 1)[0] ?? "";
  return firstLine.slice(0, maxLength);
}

/** Explicit title when present, otherwise a stable first-line projection. */
export function displayDraftTitle(
  draft: Pick<DraftSession, "text" | "title">,
  maxLength = DEFAULT_TITLE_MAX_LENGTH,
): string {
  return draft.title ?? deriveDraftTitle(draft.text, maxLength);
}
