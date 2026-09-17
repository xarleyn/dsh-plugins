/**
 * The agent-facing surface of deterministic comparison (§5–§7, §17, §25).
 *
 * Two tools share these shapes: `document_compare` produces a comparison
 * artifact and answers with its summary and a bounded preview,
 * `document_diff_read` pages through the changes the artifact holds. Neither
 * one returns a whole document, and neither one asks the model what changed:
 * the change set is computed here, and the model's job starts at
 * `document_diff_read`.
 */

import type {
  DocumentPart,
  DocumentNodeType,
  ExtractionLevel,
} from "./canonical/document-ir.js";

/** §15: the change taxonomy stays short; the node carries the nuance. */
export type ChangeKind = "insert" | "delete" | "replace" | "move";

export const CHANGE_KINDS: readonly ChangeKind[] = [
  "insert",
  "delete",
  "replace",
  "move",
];

/**
 * Deterministic lexical signals (§18).
 *
 * A signal is a fact about the edit — a number moved, a negation appeared, an
 * obligation verb turned into a permission — never a verdict. The plugin does
 * not say "risky"; it says what it saw and lets the model interpret it.
 */
export type ChangeSignal =
  | "MONEY_CHANGED"
  | "NUMBER_CHANGED"
  | "PERCENTAGE_CHANGED"
  | "DATE_CHANGED"
  | "DURATION_CHANGED"
  | "NEGATION_CHANGED"
  | "PARTY_REFERENCE_CHANGED"
  | "URL_CHANGED"
  | "EMAIL_CHANGED"
  | "OBLIGATION_TERM_CHANGED"
  | "PERMISSION_TERM_CHANGED"
  | "PROHIBITION_TERM_CHANGED"
  | "LIABILITY_TERM_CHANGED"
  | "FORMATTING_CHANGED";

export const CHANGE_SIGNALS: readonly ChangeSignal[] = [
  "MONEY_CHANGED",
  "NUMBER_CHANGED",
  "PERCENTAGE_CHANGED",
  "DATE_CHANGED",
  "DURATION_CHANGED",
  "NEGATION_CHANGED",
  "PARTY_REFERENCE_CHANGED",
  "URL_CHANGED",
  "EMAIL_CHANGED",
  "OBLIGATION_TERM_CHANGED",
  "PERMISSION_TERM_CHANGED",
  "PROHIBITION_TERM_CHANGED",
  "LIABILITY_TERM_CHANGED",
  "FORMATTING_CHANGED",
];

/**
 * Short names a caller may filter by instead of the full code (§7 uses
 * `money`, `deadline`, `obligation` in its example). A filter value matches a
 * signal when it equals the code, or names a family the code belongs to.
 */
export const SIGNAL_ALIASES: Readonly<Record<string, readonly ChangeSignal[]>> =
  {
    money: ["MONEY_CHANGED"],
    currency: ["MONEY_CHANGED"],
    number: ["NUMBER_CHANGED"],
    numbers: ["NUMBER_CHANGED"],
    percent: ["PERCENTAGE_CHANGED"],
    percentage: ["PERCENTAGE_CHANGED"],
    date: ["DATE_CHANGED"],
    dates: ["DATE_CHANGED"],
    deadline: ["DATE_CHANGED", "DURATION_CHANGED"],
    duration: ["DURATION_CHANGED"],
    term: ["DURATION_CHANGED", "DATE_CHANGED"],
    negation: ["NEGATION_CHANGED"],
    party: ["PARTY_REFERENCE_CHANGED"],
    parties: ["PARTY_REFERENCE_CHANGED"],
    url: ["URL_CHANGED"],
    link: ["URL_CHANGED"],
    email: ["EMAIL_CHANGED"],
    obligation: ["OBLIGATION_TERM_CHANGED"],
    permission: ["PERMISSION_TERM_CHANGED"],
    prohibition: ["PROHIBITION_TERM_CHANGED"],
    liability: ["LIABILITY_TERM_CHANGED"],
    formatting: ["FORMATTING_CHANGED"],
  };

/**
 * Everything `document_diff_read` accepts in `filters.signals`: the signal
 * codes themselves plus the short family names §7 uses in its example. The
 * tool declares exactly this list, and a value outside it is an error rather
 * than a filter that silently matches nothing.
 */
export const SIGNAL_FILTER_VALUES: readonly string[] = [
  ...CHANGE_SIGNALS,
  ...Object.keys(SIGNAL_ALIASES).sort(),
];

/** One run of the token diff (§14): equal, deleted or inserted text. */
export interface DiffSpan {
  readonly kind: "equal" | "delete" | "insert";
  readonly text: string;
}

/** Where a change happened, per side (§17 `left`/`right`). */
export interface ChangeLocation {
  readonly part: DocumentPart;
  /** Index of the node inside its part, in document order. */
  readonly nodeIndex: number;
  /** Heading stack the node sits under, outermost first. */
  readonly headingPath: readonly string[];
  readonly paragraph?: number;
  readonly page?: number;
  readonly table?: number;
  readonly row?: number;
  readonly column?: number;
  readonly xmlPath?: string;
}

/** Surroundings of a change, so the model can read it in context (§17). */
export interface ChangeContext {
  readonly headingPath: readonly string[];
  readonly previous?: string;
  readonly next?: string;
}

export interface DocumentChange {
  /** Stable across runs for the same inputs (§24): `chg_<12 hex>`. */
  readonly id: string;
  readonly kind: ChangeKind;
  readonly nodeType: DocumentNodeType;
  readonly left?: ChangeLocation;
  readonly right?: ChangeLocation;
  readonly before?: string;
  readonly after?: string;
  readonly spans?: readonly DiffSpan[];
  readonly context: ChangeContext;
  readonly signals: readonly ChangeSignal[];
  /** 0..1; how much the deterministic layer trusts this particular change. */
  readonly confidence: number;
}

/** Which parts of the documents take part (§5.1 `scope`). */
export type ComparisonScope = "body" | "all";

/** §5.1 `mode`; `contract` is the conservative set of defaults. */
export type ComparisonMode = "default" | "contract";

export interface ComparisonOptions {
  readonly detectMoves?: boolean;
  readonly includeHeaders?: boolean;
  readonly includeFooters?: boolean;
  readonly includeFootnotes?: boolean;
  readonly includeComments?: boolean;
  readonly ignoreWhitespace?: boolean;
  readonly ignoreFormatting?: boolean;
}

/** A document to compare: a path in the session scope, or an artifact id. */
export interface DocumentReference {
  readonly path?: string;
  readonly artifactId?: string;
}

export interface DocumentCompareInput {
  readonly left: DocumentReference;
  readonly right: DocumentReference;
  readonly mode?: ComparisonMode;
  readonly scope?: ComparisonScope;
  readonly options?: ComparisonOptions;
}

/** Extraction quality of the pair, and why it is what it is (§25). */
export interface ComparisonQuality {
  readonly level: ExtractionLevel;
  readonly leftExtraction: string;
  readonly rightExtraction: string;
  readonly ocrUsed: boolean;
  readonly reasons: readonly string[];
}

export interface ComparisonSummary {
  readonly insertions: number;
  readonly deletions: number;
  readonly replacements: number;
  readonly moves: number;
  readonly affectedSections: number;
  readonly total: number;
}

/** One preview line of `document_compare` (§6). */
export interface ComparisonPreviewEntry {
  readonly changeId: string;
  readonly kind: ChangeKind;
  readonly location: string;
  readonly before: string;
  readonly after: string;
  readonly signals: readonly ChangeSignal[];
}

export interface ComparedSide {
  readonly name: string;
  readonly sha256: string;
  readonly format: string;
  readonly nodes: number;
}

export interface DocumentCompareResult {
  readonly comparisonId: string;
  readonly status: "completed";
  readonly left: ComparedSide;
  readonly right: ComparedSide;
  readonly quality: ComparisonQuality;
  readonly summary: ComparisonSummary;
  readonly preview: readonly ComparisonPreviewEntry[];
  /** True when the preview is shorter than the change set. */
  readonly previewTruncated: boolean;
  readonly changesPath: string;
  readonly reportPath: string;
  readonly manifestPath: string;
  readonly warnings: readonly DocumentWarningLike[];
}

/** The warning shape the comparison tools report (a subset of §25 codes). */
export interface DocumentWarningLike {
  readonly code: string;
  readonly message: string;
  readonly backend?: string;
}

export interface DocumentDiffReadInput {
  readonly comparisonId: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly filters?: {
    readonly section?: string;
    readonly kinds?: readonly ChangeKind[];
    readonly signals?: readonly string[];
  };
}

/** A change as `document_diff_read` returns it: no internal bookkeeping. */
export interface DocumentDiffReadResult {
  readonly comparisonId: string;
  readonly changes: readonly DocumentChange[];
  readonly nextCursor?: string;
  readonly remaining: number;
  readonly total: number;
  readonly returned: number;
}
