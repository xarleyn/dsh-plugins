/**
 * A file the agent produced during the turn an answer belongs to.
 *
 * An artifact has no attachment-store handle: it lives in the chat's own
 * workspace, so the card addresses it by the workspace-relative name the
 * producing tool reported — the spelling the Host's workspace reads take, and
 * the only spelling that cannot publish the directory the deployment keeps
 * this account's workspace in.
 */
export interface QaArtifactView {
  readonly workflow?: {
    readonly id: string;
    readonly revision: number;
    readonly sha256: string;
    readonly status: string;
  };
  /** Workspace-relative path; the identifier every workspace read takes. */
  readonly path: string;
  /** Last path segment, which is what the card is signed with. */
  readonly name: string;
  /** Format the producing tool reported: `docx`, `pdf` or `md`. */
  readonly format: string;
  /** Bytes as the tool reported them; null when it reported no size. */
  readonly bytes: number | null;
}

/** Compact, authenticated state used by the approval action beside a draft. */
export interface QaDocumentWorkflowStatus {
  readonly id: string;
  readonly revision: number;
  readonly status: string;
  readonly sha256: string | null;
  readonly blockers: readonly string[];
}
