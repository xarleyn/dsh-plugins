/**
 * Why one skill draft cannot be saved, or why it saves with a caveat. Codes
 * stay stable on the wire; the browser owns the Russian copy.
 */
export type QaSkillDiagnosticCode =
  | "name-required"
  | "name-invalid"
  | "name-mismatch"
  | "description-required"
  | "description-too-long"
  | "when-to-use-too-long"
  | "field-type-invalid"
  | "invocation-never"
  | "invocation-invalid"
  | "invocation-legacy-key"
  | "allowed-tools-invalid"
  | "tool-name-invalid"
  | "tool-unavailable"
  | "tools-too-many"
  | "file-too-large"
  | "frontmatter-missing"
  | "skill-file-missing"
  | "skill-file-truncated"
  | "frontmatter-invalid"
  | "unknown-field"
  | "resource-unsupported";

/** One finding about a skill file or an editor draft. */
export interface QaSkillDiagnostic {
  readonly code: QaSkillDiagnosticCode;
  readonly severity: "error" | "warning";
  /** The editor field the message belongs to, or null for a file-wide one. */
  readonly field: string | null;
  /** The offending value: a tool name, a frontmatter key, a limit. */
  readonly detail: string | null;
}

/**
 * A JSON-representable frontmatter value. The editor receives the preserved
 * foreign fields verbatim over the Host bridge, which carries JSON only, so
 * the parser drops anything a YAML document can hold but JSON cannot.
 */
export type QaSkillJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly QaSkillJsonValue[]
  | { readonly [key: string]: QaSkillJsonValue };

/** One personal skill as the catalog list renders it. */
/**
 * One administrator write to a skill somebody else owns.
 *
 * The record exists so a personal skill cannot be changed behind its owner's
 * back: it is written beside the skill and reported on every read, and the
 * owner sees the badge in their own catalog.
 */
export interface QaSkillAdminEdit {
  /** Administrator account id; the owner is told a role, not a colleague. */
  readonly actorId: string;
  /** ISO timestamp of that write. */
  readonly at: string;
}

/**
 * Which skill store an administrator is editing: the deployment-wide shared
 * root every account may read, or one account's own directory.
 */
export type QaAdminSkillScope =
  | { readonly kind: "shared" }
  | { readonly kind: "user"; readonly userId: string };

/** The account a personal skill scope belongs to, for the console's header. */
export interface QaAdminSkillOwner {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
}

/** One scope's catalog plus the facts the console names it by. */
export interface QaAdminSkillsView {
  readonly scope: QaAdminSkillScope;
  /** The account of a personal scope; null for the shared root. */
  readonly owner: QaAdminSkillOwner | null;
  readonly skills: readonly QaSkillSummary[];
  /** Absolute directory this scope reads and writes, rendered read-only. */
  readonly rootPath: string;
}

export interface QaSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string | null;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  /** Declared tools, in canonical order; unknown ones included. */
  readonly allowedTools: readonly string[];
  /** Declared tools the current QA scope cannot use; still stored as declared. */
  readonly unavailableTools: readonly string[];
  /** Entries in the skill directory besides SKILL.md (references, assets, …). */
  readonly resourceCount: number;
  readonly valid: boolean;
  readonly diagnostics: readonly QaSkillDiagnostic[];
  readonly updatedAt: string | null;
  /** sha256 of the stored bytes; an update must echo the revision it read. */
  readonly revision: string;
  /**
   * The administrator write that produced the stored revision, or null. A
   * record whose revision no longer matches is stale and reports as null: the
   * badge answers "did an administrator write what I am looking at", not
   * "was this skill ever touched by an administrator".
   */
  readonly adminEdit: QaSkillAdminEdit | null;
}

/** One personal skill with everything the editor needs. */
export interface QaSkillDocument extends QaSkillSummary {
  readonly body: string;
  /** Frontmatter the editor preserves but does not own. */
  readonly extraFrontmatter: Readonly<Record<string, QaSkillJsonValue>>;
  /** Absolute SKILL.md path; rendered read-only for advanced users. */
  readonly sourcePath: string;
  /** The canonical file the serializer writes, built from the parsed content. */
  readonly preview: string;
  /**
   * True when the stored file is larger than the Host's read ceiling, so `body`
   * and `preview` describe its head only. A save over such a document erases
   * the unread tail, and the Host refuses it until the client confirms.
   */
  readonly truncated: boolean;
}

/** One tool the picker can offer, with this deployment's availability. */
export interface QaSkillToolDescriptor {
  readonly name: string;
  readonly description: string;
  /** False when the QA session's own scope cannot use the tool. */
  readonly available: boolean;
}

/** The editor's save payload. */
export interface QaSkillDraftInput {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string | null;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly allowedTools: readonly string[];
  readonly body: string;
  /** Echo of the revision the editor read; a stale one is refused. */
  readonly expectedRevision: string | null;
  /**
   * The client's acknowledgement that it is saving from an incomplete copy: the
   * stored `SKILL.md` is over the read ceiling, so the draft carries the head
   * of the file and a save would drop everything the read never loaded. A write
   * without it is refused.
   */
  readonly confirmPartialOverwrite?: boolean;
}

/**
 * The Host's answer about one unsaved draft: the file a save would write and
 * the diagnostics it found. The editor shows its own subset immediately and
 * this authoritative set as soon as it arrives.
 */
export interface QaSkillValidation {
  readonly preview: string;
  readonly diagnostics: readonly QaSkillDiagnostic[];
}

/** What one delete did: v1 keeps the directory recoverable. */
export interface QaSkillRemoval {
  readonly name: string;
  readonly trashed: boolean;
}
