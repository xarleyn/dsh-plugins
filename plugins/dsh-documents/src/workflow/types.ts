import type { DocumentFileResult } from "../documents/types.js";

/** Source references stay explicit; customer requests do not prove product capabilities. */
export interface WorkflowEvidence {
  readonly source: string;
  readonly quote: string;
  readonly productVersion?: string;
}

export interface WorkflowFact {
  readonly key: string;
  readonly value: string;
  readonly evidence: WorkflowEvidence;
}

export interface WorkflowRequirement {
  readonly id: string;
  readonly text: string;
  readonly coverage: "full" | "partial" | "none" | "unclear";
  readonly modules: readonly string[];
  readonly evidence: readonly WorkflowEvidence[];
  /** An explicit decision accepting a documented limitation, with its source. */
  readonly limitationDecision?: WorkflowEvidence;
}

export interface CommercialLine {
  readonly sku: string;
  readonly title: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly quantitySource: string;
  readonly priceSource: string;
}

export interface CalculatedCommercial {
  readonly currency: string;
  readonly lines: readonly (CommercialLine & { readonly total: string })[];
  readonly total: string;
  readonly rounding: "half-up-per-line-2-decimals";
}

export interface WorkflowDraft {
  readonly revision: number;
  readonly path: string;
  readonly sha256: string;
  readonly contextSha256: string;
  readonly review?: {
    readonly verdict: "pass" | "revise";
    readonly summary: string;
    readonly issues: readonly string[];
    readonly checkedAt: string;
  };
  readonly approval?: {
    readonly actor: string;
    readonly approvedAt: string;
  };
}

export interface DocumentWorkflow {
  readonly id: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly kind: "proposal" | "specification";
  readonly template: string;
  readonly templateSha256: string;
  readonly productVersion: string;
  readonly request: string;
  readonly revision: number;
  readonly facts: readonly WorkflowFact[];
  readonly requirements: readonly WorkflowRequirement[];
  readonly excludedModules: readonly string[];
  readonly scopeDepth: "minimal" | "extended";
  readonly unresolved: readonly string[];
  readonly commercial?: CalculatedCommercial;
  readonly draft?: WorkflowDraft;
  readonly exports: readonly {
    readonly draftSha256: string;
    readonly exportedAt: string;
    readonly files: readonly DocumentFileResult[];
  }[];
}

/** Model/browser view never carries the Host state location or workspace owner path. */
export interface DocumentWorkflowView {
  readonly id: string;
  readonly kind: DocumentWorkflow["kind"];
  readonly template: string;
  readonly productVersion: string;
  readonly revision: number;
  readonly status:
    "intake" | "clarifying" | "draft" | "reviewed" | "approved" | "exported";
  readonly request: string;
  readonly facts: readonly WorkflowFact[];
  readonly requirements: readonly WorkflowRequirement[];
  readonly excludedModules: readonly string[];
  readonly scopeDepth: DocumentWorkflow["scopeDepth"];
  readonly blockers: readonly string[];
  readonly commercial?: CalculatedCommercial;
  readonly draft?: WorkflowDraft;
  readonly markdown?: string;
  readonly templateContent?: string;
}

export class WorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}
