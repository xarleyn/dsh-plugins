export type CorrectionTarget =
  | "file-selection"
  | "filesystem-scope"
  | "tool-choice"
  | "command"
  | "workflow"
  | "package-manager"
  | "git"
  | "deploy"
  | "style"
  | "testing"
  | "environment"
  | "agent-behavior"
  | "other";

export type CorrectionDurability =
  | "one-off"
  | "likely-project-rule"
  | "likely-user-rule"
  | "likely-skill"
  | "uncertain";

export interface CorrectionClassification {
  readonly isCorrection: boolean;
  readonly confidence: number;
  readonly target: CorrectionTarget;
  readonly durability: CorrectionDurability;
  readonly severity: "preference" | "workflow" | "destructive-risk" | "security";
  readonly correctedBehavior?: string;
}

export type ContextEventKind = "user" | "assistant" | "tool-call" | "tool-result";

export interface CorrectionContextEvent {
  readonly seq: number;
  readonly kind: ContextEventKind;
  readonly text: string;
}

export interface CorrectionEvidence {
  readonly sessionId: string;
  readonly userEventSeq: number;
  readonly userText: string;
  readonly previousUserEvent?: number;
  readonly previousAssistantEvents: readonly number[];
  readonly previousToolEvents: readonly number[];
  readonly contextEvents: readonly CorrectionContextEvent[];
  readonly contextDigest: string;
  readonly cwd: string;
  readonly timestamp: number;
  readonly matchedSignals: readonly string[];
  readonly likelyOneOff: boolean;
}

export interface CorrectionRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly eventSeq: number;
  readonly workspaceKey: string;
  readonly cwd: string;
  /** Bounded, redacted text by default; full raw text only when explicitly configured. */
  readonly text: string;
  readonly textDigest: string;
  readonly contextDigest: string;
  readonly contextEvents: readonly CorrectionContextEvent[];
  readonly previousUserEvent?: number;
  readonly previousAssistantEvents: readonly number[];
  readonly previousToolEvents: readonly number[];
  readonly matchedSignals: readonly string[];
  readonly likelyOneOff: boolean;
  readonly classification?: CorrectionClassification;
  readonly createdAt: number;
}

export interface ScanCursor {
  readonly workspaceKey: string;
  readonly lastAnalyzedSession?: string;
  readonly lastAnalyzedEventSeq?: number;
  readonly sessionWatermarks: Readonly<Record<string, number>>;
  readonly updatedAt: number;
}

export interface ScanRequest {
  readonly cwd: string;
  readonly lastSessions?: number;
  readonly from?: number;
  readonly to?: number;
  readonly incremental?: boolean;
}

export interface ScanReport {
  readonly workspaceKey: string;
  readonly sessionsConsidered: number;
  readonly sessionsScanned: number;
  readonly sessionsFailed: number;
  readonly eventsScanned: number;
  readonly correctionsFound: number;
  readonly correctionsAdded: number;
}

export interface CorrectionStore {
  getCursor(workspaceKey: string): ScanCursor | undefined;
  putCursor(cursor: ScanCursor): Promise<void>;
  hasCorrection(id: string): boolean;
  putCorrection(record: CorrectionRecord, maxRecordsPerWorkspace: number): Promise<void>;
  countCorrections(workspaceKey: string): number;
  listCorrections(workspaceKey: string, limit?: number): readonly CorrectionRecord[];
}
