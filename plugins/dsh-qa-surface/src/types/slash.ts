import type { QaImageMediaType } from "./session.js";

// ---------------------------------------------------------------------------
// Slash interface: the unified catalog, its policy and the command outcome.
// QA owns presentation, filtering and admission; it owns no skill or command
// registry of its own — every entry below is a projection of a native one.
// ---------------------------------------------------------------------------

/** Which native registry one unified entry came from. */
export type QaSlashEntryKind = "skill" | "command";

/** How one half of the catalog admits native entries. */
export type QaSlashPolicyMode = "deny-all" | "allow-list" | "all";

export interface QaSlashPolicyConfig {
  readonly mode?: QaSlashPolicyMode;
  readonly allow?: readonly string[];
}

export interface QaSlashPaletteConfig {
  readonly enabled?: boolean;
  /** Run the two weakest matcher rungs (substring, subsequence). */
  readonly fuzzySearch?: boolean;
  readonly maxVisible?: number;
  readonly showDescriptions?: boolean;
  readonly showKindBadge?: boolean;
}

export interface QaSlashCommandsConfig {
  readonly skills?: QaSlashPolicyConfig;
  readonly commands?: QaSlashPolicyConfig;
  readonly palette?: QaSlashPaletteConfig;
}

export interface ResolvedQaSlashCommands {
  /** Mirror of `lockdown.allowSlashCommands`; the one master switch. */
  readonly enabled: boolean;
  readonly skills: {
    readonly mode: QaSlashPolicyMode;
    readonly allow: readonly string[];
  };
  readonly commands: {
    readonly mode: QaSlashPolicyMode;
    readonly allow: readonly string[];
  };
  readonly palette: {
    readonly enabled: boolean;
    readonly fuzzySearch: boolean;
    readonly maxVisible: number;
    readonly showDescriptions: boolean;
    readonly showKindBadge: boolean;
  };
  /**
   * True when the deployment turned the master switch on without declaring a
   * `slashCommands` section: skills then admit every user-invocable skill the
   * session already exposes, commands stay denied. The Host logs it once, so
   * an upgrade cannot silently widen anything.
   */
  readonly legacyDefaults: boolean;
}

/**
 * One palette row. `id` is the routing identity: skill and command may share a
 * name, so identity is `skill:<name>` or `command:<name>` and never the bare
 * name the two halves would collide on.
 */
export interface QaSlashCatalogEntry {
  readonly id: string;
  readonly kind: QaSlashEntryKind;
  readonly name: string;
  readonly description: string;
  /** Skill-only: the native `whenToUse`, rendered as secondary copy. */
  readonly whenToUse?: string;
  /** Skill-only: whether the model is also offered this skill. */
  readonly modelInvocable?: boolean;
  /** Command-only: the advertised argument shape. */
  readonly inputHint?: string;
  /** Command-only: whether the executor admits composer attachments. */
  readonly acceptsAttachments?: boolean;
}

/**
 * Whether the command half of the catalog could be read. `inactive` is the
 * ordinary state of a cold chat: the native command registry resolves through
 * a live Agent, and a chat with none answers with no commands rather than an
 * error — the palette then offers skills alone.
 */
export type QaSlashCommandSurface = "ready" | "unavailable" | "inactive";

export interface QaSlashCatalog {
  /** False while `lockdown.allowSlashCommands` is off. */
  readonly enabled: boolean;
  readonly entries: readonly QaSlashCatalogEntry[];
  readonly commandSurface: QaSlashCommandSurface;
  /**
   * User-invocable skills of this chat that the deployment or the chat's role
   * withheld from the palette. Naming them is what lets the browser warn about
   * a `/name` typed inside an ordinary prompt — the native gesture path never
   * consults this list, so it is a courtesy, not an authorization.
   */
  readonly deniedSkills: readonly string[];
}

/**
 * One composer attachment offered to a human command. The same two shapes the
 * prompt path uses — an image rides inline, a file rides its staged receipt —
 * because the native executor admits both through one attachment store.
 */
export type QaSlashSubmitAttachment =
  | {
      readonly type: "image";
      readonly mediaType: QaImageMediaType;
      readonly data: string;
      readonly name?: string;
    }
  | { readonly type: "file"; readonly receiptId: string };

/** Why a command line was refused before, or instead of, running. */
export type QaSlashRefusal =
  | "slash-disabled"
  | "unknown-command"
  | "not-allowed"
  | "attachments-unsupported"
  | "inactive-session";

export type QaSlashCommandOutcome =
  | {
      readonly kind: "success";
      readonly text?: string;
      /** Earlier authoritative event this result is presented from. */
      readonly sourceEventSeq?: number;
    }
  | { readonly kind: "error"; readonly text: string };

/**
 * The result of one admitted command. `refused` is an admission decision and
 * costs nothing; `executed` means the native runtime ran the handler and the
 * lifecycle is already in the session log, which is what the transcript row
 * projects.
 */
export type QaSlashExecution =
  | {
      readonly kind: "executed";
      readonly commandId: string;
      readonly outcome: QaSlashCommandOutcome;
    }
  | {
      readonly kind: "refused";
      readonly reason: QaSlashRefusal;
      /** Host-authored detail; the browser renders its own copy for `reason`. */
      readonly message: string;
    };

/** One entry of the palette the browser is filtering. */
export interface QaSlashView {
  readonly enabled: boolean;
  readonly state: "idle" | "loading" | "ready" | "error";
  readonly entries: readonly QaSlashCatalogEntry[];
  readonly commandSurface: QaSlashCommandSurface;
  readonly deniedSkills: readonly string[];
  /** Set when the catalog could not be read; ordinary prompts keep working. */
  readonly error: string | null;
  /**
   * Bumped when the surface must re-open a palette the user had dismissed —
   * an ambiguous `/name` is the case that needs it. The composer watches the
   * counter rather than the message, so a refusal can be re-stated.
   */
  readonly reopen: number;
}

/**
 * One human command line projected into the transcript. Commands never enter
 * the model conversation, so this row is their only visible trace; it is a
 * control row, not an assistant bubble.
 */
export interface QaCommandActivity {
  readonly commandId: string;
  readonly name: string;
  /** Verbatim text after the name, with its separator whitespace removed. */
  readonly args?: string;
  readonly state: "running" | "success" | "error";
  readonly resultText?: string;
  readonly sourceEventSeq?: number;
}
