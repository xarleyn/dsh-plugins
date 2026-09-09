export type RepairMode = "observe" | "suggest" | "auto";

export type RepairRuleId = "R001" | "R006" | "R007";

export type RepairIssueKind =
  | "icon-alignment"
  | "unexpected-overflow-y"
  | "clipped-content";

export type RepairSeverity = "low" | "medium" | "high";

export interface RepairIssue {
  readonly id: string;
  readonly ruleId: RepairRuleId;
  readonly kind: RepairIssueKind;
  readonly severity: RepairSeverity;
  readonly confidence: number;
  readonly plugin?: string;
  readonly root: string;
  readonly target: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly suggestedCss?: Readonly<Record<string, string>>;
}

export interface RepairVerification {
  readonly ok: boolean;
  readonly reason: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export type RepairHistoryStatus =
  | "applied"
  | "verified"
  | "rolled-back"
  | "verification-failed";

export interface RepairHistoryEntry {
  readonly repairId: string;
  readonly timestamp: string;
  readonly issue: RepairIssue;
  readonly status: RepairHistoryStatus;
  readonly verification?: RepairVerification;
}

export interface ScanReport {
  readonly startedAt: string;
  readonly durationMs: number;
  readonly mode: RepairMode;
  readonly rootsScanned: number;
  readonly issues: readonly RepairIssue[];
  readonly applied: readonly string[];
  readonly rolledBack: readonly string[];
}

export interface UIRepairConfig {
  readonly mode: RepairMode;
  readonly autoConfidence: number;
  readonly dangerousConfidence: number;
  readonly rootSelector: string;
  readonly observeMutations: boolean;
  readonly maxElementsPerRoot: number;
  readonly alignmentTolerancePx: number;
  readonly overflowTolerancePx: number;
}

export interface UIRepairService {
  scan(root?: ParentNode): Promise<ScanReport>;
  getLatestReport(): ScanReport | undefined;
  getHistory(): readonly RepairHistoryEntry[];
  getMode(): RepairMode;
  setMode(mode: RepairMode): void;
  rollback(repairId: string): boolean;
  rollbackAll(): void;
}

export interface RepairCandidate {
  readonly issue: RepairIssue;
  readonly root: HTMLElement;
  readonly target: HTMLElement;
  verify(): RepairVerification;
}
