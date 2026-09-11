export type QaSourceKind =
  "file" | "code" | "web" | "jira" | "confluence" | "knowledge" | "other";

export type QaSourceEvidence =
  "read" | "fetched" | "queried" | "reported" | "inherited" | "discovered";

export interface QaSourceLocation {
  readonly path?: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly anchor?: string;
  readonly jiraKey?: string;
  readonly confluencePageId?: string;
}

export interface QaSourceOrigin {
  readonly sessionId: string;
  readonly turn: number;
  readonly step?: number;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly agentId?: string;
  readonly role: "parent" | "subagent";
  readonly subagentRunId?: string;
  readonly subagentSessionId?: string;
}

export interface QaSourceReference {
  /** Stable identity after path, URL or provider-specific normalization. */
  readonly id: string;
  readonly kind: QaSourceKind;
  readonly title: string;
  readonly uri?: string;
  readonly path?: string;
  readonly snippet?: string;
  readonly locations: readonly QaSourceLocation[];
  readonly evidence: QaSourceEvidence;
  readonly origins: readonly QaSourceOrigin[];
  readonly score: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface QaTurnSources {
  readonly version: 1;
  readonly sessionId: string;
  readonly turn: number;
  readonly sources: readonly QaSourceReference[];
  readonly discovered?: readonly QaSourceReference[];
  readonly complete: boolean;
  readonly incompleteOrigins?: readonly {
    readonly subagentRunId?: string;
    readonly provider?: string;
    readonly reason: string;
  }[];
}

export interface SourceExtractorContext {
  readonly toolName: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly presentation?: unknown;
  readonly origin: QaSourceOrigin;
}

export interface SourceExtractor {
  readonly id: string;
  matches(context: SourceExtractorContext): boolean;
  extract(context: SourceExtractorContext): readonly QaSourceReference[];
}
