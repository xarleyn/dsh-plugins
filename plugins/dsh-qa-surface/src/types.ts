export type QaSessionPolicy = "browser-persistent" | "new-on-load" | "fixed";
export type QaSandboxMode = "read-only";
export type QaApprovalPolicy = "never";
export type QaToolPolicyMode = "allow-list";

export interface QaSurfaceConfig {
  readonly enabled?: boolean;
  readonly route?: {
    readonly path?: string;
    readonly matchChildren?: boolean;
  };
  readonly branding?: {
    readonly title?: string;
    readonly subtitle?: string;
    readonly welcomeMessage?: string;
    readonly placeholder?: string;
    readonly logoUrl?: string | null;
  };
  readonly session?: {
    readonly policy?: QaSessionPolicy;
    readonly storageKey?: string;
    readonly workspaceId?: string | null;
    readonly fixedSessionId?: string | null;
    readonly agentPreset?: string | null;
    readonly provider?: string | null;
    readonly model?: string | null;
    readonly reasoningEffort?: string | null;
  };
  readonly ui?: {
    readonly showHeader?: boolean;
    readonly showReset?: boolean;
    readonly showStop?: boolean;
    readonly showTimestamps?: boolean;
    readonly showToolActivity?: boolean;
    readonly showReasoning?: boolean;
    readonly renderMarkdown?: boolean;
    readonly maxContentWidth?: number;
    readonly showSessionList?: boolean;
  };
  readonly suggestedQuestions?: readonly string[];
  readonly interaction?: {
    readonly approvals?: "blocked";
    readonly questions?: "unsupported";
  };
  readonly lockdown?: {
    readonly enabled?: boolean;
    readonly enforceFixedAgentPreset?: boolean;
    readonly enforceFixedWorkspace?: boolean;
    readonly enforceFixedModel?: boolean;
    readonly sandboxMode?: QaSandboxMode;
    readonly approvalPolicy?: QaApprovalPolicy;
    readonly permissionPreset?: string;
    readonly allowPermissionChanges?: false;
    readonly allowSlashCommands?: false;
    readonly allowSettingsMutation?: false;
    readonly allowSessionReset?: boolean;
    readonly allowSessionRename?: false;
    readonly allowSessionDelete?: false;
    readonly allowArbitrarySessionOpen?: false;
    readonly toolPolicy?: {
      readonly mode?: QaToolPolicyMode;
      readonly allow?: readonly string[];
    };
  };
  readonly embedding?: {
    readonly frameAncestors?: string | null;
  };
}

export interface ResolvedQaSurfaceConfig {
  readonly enabled: boolean;
  readonly route: {
    readonly path: string;
    readonly matchChildren: boolean;
  };
  readonly branding: {
    readonly title: string;
    readonly subtitle: string;
    readonly welcomeMessage: string;
    readonly placeholder: string;
    readonly logoUrl: string | null;
  };
  readonly session: {
    readonly policy: QaSessionPolicy;
    readonly storageKey: string;
    readonly workspaceId: string | null;
    readonly fixedSessionId: string | null;
    readonly agentPreset: string | null;
    readonly provider: string | null;
    readonly model: string | null;
    readonly reasoningEffort: string | null;
  };
  readonly ui: {
    readonly showHeader: boolean;
    readonly showReset: boolean;
    readonly showStop: boolean;
    readonly showTimestamps: boolean;
    readonly showToolActivity: boolean;
    readonly showReasoning: boolean;
    readonly renderMarkdown: boolean;
    readonly maxContentWidth: number;
    readonly showSessionList: boolean;
  };
  readonly suggestedQuestions: readonly string[];
  readonly interaction: {
    readonly approvals: "blocked";
    readonly questions: "unsupported";
  };
  readonly lockdown: {
    readonly enabled: boolean;
    readonly enforceFixedAgentPreset: boolean;
    readonly enforceFixedWorkspace: boolean;
    readonly enforceFixedModel: boolean;
    readonly sandboxMode: QaSandboxMode;
    readonly approvalPolicy: QaApprovalPolicy;
    readonly permissionPreset: string;
    readonly allowPermissionChanges: false;
    readonly allowSlashCommands: false;
    readonly allowSettingsMutation: false;
    readonly allowSessionReset: boolean;
    readonly allowSessionRename: false;
    readonly allowSessionDelete: false;
    readonly allowArbitrarySessionOpen: false;
    readonly toolPolicy: {
      readonly mode: QaToolPolicyMode;
      readonly allow: readonly string[];
    };
  };
  readonly embedding: {
    readonly frameAncestors: string | null;
  };
}

/** Host-attested facts required before the QA composer may become writable. */
export interface QaLockdownProof {
  readonly sessionId: string;
  readonly enabled: boolean;
  readonly agentPresetMatches: boolean;
  readonly workspaceMatches: boolean;
  readonly modelMatches: boolean;
  readonly sandboxIsReadOnly: boolean;
  readonly approvalIsNever: boolean;
  readonly permissionPreset: string;
  readonly toolPolicyLoaded: boolean;
  readonly toolAllowList: readonly string[];
}

export type QaMessage =
  | {
      readonly id: string;
      readonly role: "user";
      readonly text: string;
      readonly status: "committed";
      readonly timestamp?: number;
    }
  | {
      readonly id: string;
      readonly role: "assistant";
      readonly text: string;
      readonly status: "streaming" | "committed" | "failed";
      readonly timestamp?: number;
      /** Host turn this answer belongs to; groups regenerations into variants. */
      readonly turn?: number;
      /** Host-recorded response timing, present on finalized messages only. */
      readonly stats?: {
        /** step start → final message. */
        readonly durationMs: number;
        /** step start → first token; null when no token delta was recorded. */
        readonly ttftMs: number | null;
        /** Estimated from visible text (≈4 chars/token) over the generation window. */
        readonly tokensPerSecond: number | null;
      };
    }
  | {
      readonly id: string;
      readonly role: "system";
      readonly text: string;
      readonly status: "info" | "error";
      readonly timestamp?: number;
    }
  | {
      readonly id: string;
      readonly role: "work";
      readonly turn: number;
      readonly status: "running" | "complete";
      readonly startedAt?: number;
      readonly endedAt?: number;
      readonly items: readonly QaWorkItem[];
    };

export type QaWorkItem =
  | {
      readonly id: string;
      readonly kind: "reasoning" | "progress";
      readonly text: string;
      readonly status: "running" | "complete";
    }
  | {
      readonly id: string;
      readonly kind: "tool";
      readonly name: string;
      readonly label: string;
      readonly summary: string;
      readonly input: string | null;
      readonly output: string | null;
      readonly status: "running" | "ok" | "error" | "stopped";
      readonly startedAt?: number;
      readonly endedAt?: number;
    };

export type QaSessionPhase =
  | "idle"
  | "creating"
  | "ready"
  | "running"
  | "reconnecting"
  | "blocked"
  | "error";

/** One tool-derived source shown in the sources drawer. */
export interface QaSource {
  readonly id: string;
  readonly kind: "web" | "search" | "file";
  /** URL, filesystem path or search query as the model supplied it. */
  readonly target: string;
  readonly title: string;
  readonly snippet: string;
}

export interface QaSessionState {
  readonly phase: QaSessionPhase;
  readonly sessionId: string | null;
  readonly messages: readonly QaMessage[];
  readonly error: string | null;
  readonly canSend: boolean;
  readonly canStop: boolean;
  /** Bumped whenever this browser's chat index changes (add/forget). */
  readonly chatsRevision: number;
  /** Tool-derived sources of the current chat (web targets and files read). */
  readonly sources: readonly QaSource[];
}
