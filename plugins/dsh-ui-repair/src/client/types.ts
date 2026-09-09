import type {
  RepairMode,
  RepairRuleId,
  UIRepairIgnoreRule,
} from "../shared/config.js";

export type {
  RepairMode,
  RepairRuleId,
  UIRepairIgnoreRule,
} from "../shared/config.js";

export type RepairIssueKind =
  | "icon-alignment"
  | "icon-size-consistency"
  | "row-horizontal-alignment"
  | "row-vertical-alignment"
  | "unexpected-overflow-x"
  | "unexpected-overflow-y"
  | "clipped-content"
  | "flex-shrink-anomaly"
  | "missing-min-width-zero";

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
  readonly ignored: readonly string[];
}

export interface UIRepairConfig {
  readonly enabled: boolean;
  readonly mode: RepairMode;
  readonly autoConfidence: number;
  readonly dangerousConfidence: number;
  readonly rootSelector: string;
  readonly scanOnStartup: boolean;
  readonly observeMutations: boolean;
  readonly observeResize: boolean;
  readonly ignore: readonly UIRepairIgnoreRule[];
  readonly maxElementsPerRoot: number;
  readonly alignmentTolerancePx: number;
  readonly overflowTolerancePx: number;
}

export interface UIRepairService {
  scan(root?: ParentNode): Promise<ScanReport>;
  getLatestReport(): ScanReport | undefined;
  getRevision(): number;
  subscribe(listener: () => void): () => void;
  getHistory(): readonly RepairHistoryEntry[];
  apply(repairId: string): Promise<boolean>;
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
