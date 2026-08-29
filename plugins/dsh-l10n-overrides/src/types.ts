export type DomTranslationAttribute =
  "placeholder" | "title" | "aria-label" | "alt";

export interface DomTranslationRule {
  readonly source: string;
  readonly target: string;
  readonly scope: string;
  readonly mode?: "exact";
  readonly attributes?: readonly DomTranslationAttribute[];
}

export interface TranslationPack {
  readonly id: string;
  readonly target: {
    readonly package: string;
    readonly versions?: string;
  };
  readonly en: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly dom?: readonly DomTranslationRule[];
  readonly metadata?: {
    readonly sourceLanguage?: string;
    readonly description?: string;
    readonly upstream?: string;
  };
}

export type DiagnosticLevel = "info" | "warning" | "error" | "debug";

export interface DiagnosticEntry {
  readonly level: DiagnosticLevel;
  readonly code: string;
  readonly message: string;
}
