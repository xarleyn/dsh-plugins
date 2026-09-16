import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";

/**
 * One entry of the QA tool catalog.
 *
 * `group` and `tags` are passive metadata: the MVP activation policy activates
 * the whole catalog and never filters on them. They exist so a later
 * `activationMode` can select subsets without touching the tool definitions.
 */
export interface QaToolDescriptor {
  readonly definition: ToolDefinition;
  /** Capability bucket reserved for a future grouped activation mode. */
  readonly group?: string;
  /** Free-form labels reserved for a future search/unlock mode. */
  readonly tags?: readonly string[];
}

/** Why one activation ran; the origin only shapes logging and the event guard. */
export type QaToolActivationOrigin = "skill" | "restore" | "immediate";

/** Runtime activation state of one live agent. */
export interface QaToolActivationState {
  status: "inactive" | "activating" | "active";
  /** Catalog version whose tools are registered; set once `status` is active. */
  catalogVersion?: string | undefined;
  /** Exact disposers returned by `tools.register()`, in registration order. */
  disposers: (() => void)[];
}

/** Outcome of one activation attempt. */
export type QaToolActivationResult =
  | { readonly status: "activated"; readonly count: number }
  | { readonly status: "already-active" }
  | { readonly status: "failed"; readonly error: unknown };

/** The activation subsystem's observable surface, injected into the admission gate. */
export interface QaToolActivation {
  /**
   * Names currently registered on one live agent. The admission guard evaluates
   * this per execution, so a tool becomes callable exactly when it appears here.
   */
  activeToolNames(agent: Agent): readonly string[];
}
