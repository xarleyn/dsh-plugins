/**
 * Domain-domain model shared by the host half and the browser half.
 *
 * Nothing here imports a host-only or browser-only module: the client renders
 * exactly these structures, and the host produces them.
 *
 * The record uses explicit zero-values (`''`, `0`, `false`, `[]`) instead of
 * optional properties. That is deliberate: it keeps the persisted format, the
 * Typert wire contract and the Schemastery-free record schema free of the
 * absent-vs-`undefined` distinction, which the generated Remote client cannot
 * represent. Absent means "the feature is not configured", never "unknown".
 */

/** Persisted record format. Bumped only for a breaking record change. */
export const DOMAIN_RECORD_VERSION = 1;

/** Structured-output contract version the base policy asks children to honour. */
export const EXPERT_RESULT_MARKER = "domain-expert-result";

/** Stable, URL-free identifier of one user-defined domain. */
export const DOMAIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/u;

/** `shared` is reserved: it is the common memory namespace root. */
export const RESERVED_DOMAIN_IDS: readonly string[] = ["shared"];

/** Longest accepted persona instruction block (characters). */
export const MAX_INSTRUCTIONS_LENGTH = 20_000;

/** Longest accepted task/context/output block (characters). */
export const MAX_TASK_LENGTH = 16_000;

/** How an expert may reach another domain. */
export type CrossDomainMode = "disabled" | "expert-only" | "direct-read";

export const CROSS_DOMAIN_MODES: readonly CrossDomainMode[] = [
  "disabled",
  "expert-only",
  "direct-read",
];

/** What an expert is being asked to do; shapes the composed task section. */
export type ExpertMode = "investigate" | "answer" | "review";

export const EXPERT_MODES: readonly ExpertMode[] = [
  "investigate",
  "answer",
  "review",
];

/**
 * Whether a restriction is actually applied by something, or only stated to
 * the model. The UI must never present the second kind as the first.
 */
export type ScopeEnforcement = "enforced" | "advisory";

/** Resource class of one filesystem entry. */
export type ResourceClass = "primary" | "shared" | "denied";

export interface FilesystemScopeConfig {
  /** Paths the domain owns; glob patterns relative to the session cwd. */
  readonly primary: readonly string[];
  /** Cross-domain paths the expert may read but not claim. */
  readonly sharedReadOnly: readonly string[];
  /** Paths explicitly outside the domain; a match wins over any allow. */
  readonly denied: readonly string[];
}

export interface DocumentationScopeConfig {
  /** Knowledge source selectors the expert should prefer. */
  readonly include: readonly string[];
  /** Selectors the expert must not use. */
  readonly exclude: readonly string[];
}

export interface DomainScopeConfig {
  readonly filesystem: FilesystemScopeConfig;
  readonly documentation: DocumentationScopeConfig;
  /**
   * Opaque third-party scope provider config: provider id -> JSON-encoded
   * config document. The core never interprets a value; the owning provider
   * parses and validates it. Keeps the core free of Jira/Wiki/Git semantics.
   */
  readonly providers: Readonly<Record<string, string>>;
}

export interface DomainPersonaConfig {
  /** Appended to the built-in base policy; never replaces it. */
  readonly instructions: string;
}

export interface DomainMemoryConfig {
  /** Private read/write namespace, e.g. `domain/payments`. */
  readonly namespace: string;
  /** Namespaces the expert may read but not write. */
  readonly sharedReadOnly: readonly string[];
}

export interface DomainToolsConfig {
  /** Global tool names that stay visible to the expert. */
  readonly allow: readonly string[];
  /** Global tool names removed from the expert's view. */
  readonly deny: readonly string[];
}

export interface DomainDelegationConfig {
  readonly allowCrossDomain: boolean;
  readonly crossDomainMode: CrossDomainMode;
  /** Target domain ids; empty means "any other enabled domain". */
  readonly targets: readonly string[];
  /** Foreign memory namespaces readable in `direct-read` mode. */
  readonly directRead: readonly string[];
  /** Delegation depth cap handed to the subagent runtime. */
  readonly maxDepth: number;
  /** Advisory parallelism cap; executed through the caller's own tools. */
  readonly maxParallel: number;
}

export interface DomainModelConfig {
  /** When true the child inherits the caller's provider, model and effort. */
  readonly inherit: boolean;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly maxTokens: number;
}

/** One persisted domain expert. */
export interface DomainDefinition {
  readonly formatVersion: number;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  /** Presentation-only metadata; the core never interprets either field. */
  readonly icon: string;
  readonly color: string;
  readonly persona: DomainPersonaConfig;
  readonly scope: DomainScopeConfig;
  readonly memory: DomainMemoryConfig;
  readonly tools: DomainToolsConfig;
  readonly delegation: DomainDelegationConfig;
  readonly model: DomainModelConfig;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Lightweight list projection for the domain list screen. */ export interface DomainSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly icon: string;
  readonly color: string;
  readonly primaryPaths: number;
  readonly sharedPaths: number;
  readonly memoryNamespaces: number;
  readonly tools: number;
  readonly degradations: number;
  readonly updatedAt: number;
}

/** Metadata a model may see; never scope, memory or security configuration. */
export interface DomainListing {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/**
 * Resolved scope carried by a delegation (design §7). It is execution
 * metadata: consumers read it programmatically instead of parsing prose.
 */
export interface DomainScope {
  readonly domainId: string;
  readonly filesystem: FilesystemScopeConfig;
  readonly knowledge: {
    readonly include: readonly string[];
    readonly exclude: readonly string[];
  };
  /** Provider id -> JSON-encoded resolved external scope. */
  readonly external: Readonly<Record<string, string>>;
  readonly memory: {
    readonly namespace: string;
    readonly sharedNamespaces: readonly string[];
  };
}

export interface DomainExpertRequest {
  readonly task: string;
  readonly context: string;
  readonly output: string;
  readonly mode: ExpertMode;
  readonly background: boolean;
}

export type ExpertConfidence = "high" | "medium" | "low";

export interface DomainExpertFinding {
  readonly claim: string;
  readonly evidence: readonly string[];
  readonly confidence: ExpertConfidence;
}

export type DomainExpertStatus =
  | "completed"
  | "aborted"
  | "error"
  | "max-tokens"
  | "refusal"
  | "delegated"
  | "preview";

/** Structured cross-domain answer (design §19). */
export interface DomainExpertResult {
  readonly domainId: string;
  readonly expert: string;
  readonly status: DomainExpertStatus;
  readonly summary: string;
  readonly findings: readonly DomainExpertFinding[];
  readonly conflicts: readonly string[];
  readonly assumptions: readonly string[];
  readonly followUps: readonly string[];
  readonly diagnostic: string;
  readonly childSessionId: string;
  readonly durationMs: number;
  /** True when the child's text carried a parseable structured block. */
  readonly structured: boolean;
}

/** One resolved filesystem entry, with its honest enforcement level. */
export interface ResolvedResourceEntry {
  readonly path: string;
  readonly class: ResourceClass;
  readonly enforcement: ScopeEnforcement;
  /** Worker/tool ids that actually apply this restriction. */
  readonly enforcedBy: readonly string[];
  /** Scope provider that contributed the entry. */
  readonly provider: string;
  readonly note: string;
}

export interface ResolvedMemoryEntry {
  readonly namespace: string;
  readonly access: "read-write" | "read-only";
  readonly enforcement: ScopeEnforcement;
  readonly provider: string;
  readonly note: string;
}

export interface ResolvedToolEntry {
  readonly name: string;
  readonly kind: "worker" | "tool" | "infrastructure";
  readonly available: boolean;
  readonly note: string;
}

export interface ResolvedProviderEntry {
  readonly id: string;
  readonly title: string;
  readonly registered: boolean;
  readonly enforcement: ScopeEnforcement;
  readonly note: string;
}

export type DomainDegradationCode =
  | "SCOPE_PROVIDER_MISSING"
  | "MEMORY_PROVIDER_MISSING"
  | "WORKER_UNAVAILABLE"
  | "TOOL_UNVERIFIED"
  | "DELEGATION_TARGET_MISSING";

export interface DomainDegradation {
  readonly code: DomainDegradationCode;
  readonly message: string;
  readonly refs: readonly string[];
}

export interface ResolvedDelegationEntry {
  readonly domainId: string;
  readonly mode: CrossDomainMode;
  readonly allowed: boolean;
}

export interface ResolvedDelegationSummary {
  readonly mode: CrossDomainMode;
  readonly allowCrossDomain: boolean;
  readonly targets: readonly string[];
  readonly maxDepth: number;
  readonly maxParallel: number;
  readonly peers: readonly ResolvedDelegationEntry[];
}

/**
 * Everything the expert test screen and the scope inspector show. Computed by
 * one host-side resolution so both screens cannot drift apart.
 */
export interface ResolvedExpertProfile {
  readonly domainId: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly basePolicy: string;
  readonly customInstructions: string;
  readonly persona: string;
  readonly scope: DomainScope;
  readonly resources: readonly ResolvedResourceEntry[];
  readonly memory: readonly ResolvedMemoryEntry[];
  readonly tools: readonly ResolvedToolEntry[];
  readonly toolFilter: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
  };
  readonly delegation: ResolvedDelegationSummary;
  readonly model: DomainModelConfig;
  readonly providers: readonly ResolvedProviderEntry[];
  readonly degradations: readonly DomainDegradation[];
  readonly depthBudget: number;
  readonly resolvedAt: number;
}

/** Error taxonomy of the domain layer (design §32). */
export type DomainErrorCode =
  | "DOMAIN_NOT_FOUND"
  | "DOMAIN_DISABLED"
  | "DOMAIN_INVALID"
  | "DOMAIN_EXISTS"
  | "UNSUPPORTED_SUBAGENT_CAPABILITY"
  | "SUBAGENT_PROVIDER_MISSING"
  | "SCOPE_PROVIDER_MISSING"
  | "MEMORY_PROVIDER_MISSING"
  | "MEMORY_SCOPE_DENIED"
  | "WORKER_UNAVAILABLE"
  | "DELEGATION_DENIED"
  | "DELEGATION_DEPTH_EXCEEDED"
  | "PARALLELISM_EXCEEDED"
  | "EXPERT_NOT_CALLER"
  | "TASK_REJECTED"
  | "STORAGE_UNAVAILABLE";

/** Domain-provider catalog surfaced to the browser. */
export interface ScopeProviderInfo {
  readonly id: string;
  readonly title: string;
  readonly enforcement: ScopeEnforcement;
  readonly builtin: boolean;
}

export interface MemoryProviderInfo {
  readonly id: string;
  readonly title: string;
  readonly builtin: boolean;
}

export interface WorkerInfo {
  readonly id: string;
  readonly title: string;
  readonly capabilities: readonly string[];
  readonly enforces: readonly string[];
  readonly builtin: boolean;
}

export interface ToolInfo {
  readonly name: string;
  readonly provider: string;
}

export interface CatalogInfo {
  readonly scopeProviders: readonly ScopeProviderInfo[];
  readonly memoryProviders: readonly MemoryProviderInfo[];
  readonly workers: readonly WorkerInfo[];
  readonly tools: readonly ToolInfo[];
  readonly memoryNamespaces: readonly string[];
}

/** One audit record (design §33); secrets and retrieved text never enter it. */
export interface ExpertAuditEntry {
  readonly at: number;
  readonly domainId: string;
  readonly callerDomain: string | null;
  readonly callerSessionId: string;
  readonly childSessionId: string;
  readonly mode: ExpertMode;
  readonly background: boolean;
  readonly status: DomainExpertStatus;
  readonly durationMs: number;
  readonly delegatePath: readonly string[];
  readonly degraded: readonly DomainDegradationCode[];
}

/**
 * Result envelopes. Remote method results use explicit `ok`/`code` fields
 * rather than throwing, so the UI can show a reason code instead of a carrier
 * failure. Infrastructure faults still throw.
 */
export interface DomainListResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly domains: readonly DomainSummary[];
}

export interface DomainGetResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly domain: DomainDefinition | null;
}

export interface DomainWriteResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly domain: DomainDefinition | null;
}

export interface DomainDeleteResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly deleted: boolean;
}

export interface ResolvedScopeResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly profile: ResolvedExpertProfile | null;
}

export interface CatalogResult extends CatalogInfo {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
}

export interface ExpertRunResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly result: DomainExpertResult | null;
}

export interface AuditListResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly entries: readonly ExpertAuditEntry[];
}

/** One durable memory record; text is user-authored, never a secret. */
export interface MemoryRecord {
  readonly namespace: string;
  readonly key: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MemoryNamespaceView {
  readonly namespace: string;
  readonly access: "read-write" | "read-only";
  readonly records: number;
}

export interface MemoryInspectResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly namespaces: readonly MemoryNamespaceView[];
  readonly records: readonly MemoryRecord[];
}

export interface MemoryClearResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly cleared: number;
}

export interface DraftInspectionResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly definition: DomainDefinition | null;
  readonly issues: readonly ValidationIssueView[];
}

export interface ValidationIssueView {
  readonly severity: "error" | "warning";
  readonly field: string;
  readonly message: string;
}

/** Draft defaults the UI prefills when creating a domain. */
export function emptyDomainDraft(id: string, now = 0): DomainDefinition {
  return {
    formatVersion: DOMAIN_RECORD_VERSION,
    id,
    name: id,
    description: "",
    enabled: true,
    icon: "",
    color: "",
    persona: { instructions: "" },
    scope: {
      filesystem: { primary: [], sharedReadOnly: [], denied: [] },
      documentation: { include: [], exclude: [] },
      providers: {},
    },
    memory: { namespace: defaultMemoryNamespace(id), sharedReadOnly: [] },
    tools: { allow: [], deny: [] },
    delegation: {
      allowCrossDomain: true,
      crossDomainMode: "expert-only",
      targets: [],
      directRead: [],
      maxDepth: 3,
      maxParallel: 3,
    },
    model: {
      inherit: true,
      provider: "",
      model: "",
      reasoningEffort: "",
      maxTokens: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** Private memory namespace of a domain; the only place the convention lives. */
export function defaultMemoryNamespace(id: string): string {
  return `domain/${id}`;
}
