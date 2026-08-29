/**
 * Checkpoint policy (SPEC §26, §52).
 *
 * Answers "should we checkpoint now?" for every trigger the v0.1 plugin
 * wires: slot switch, session flush, session disposal, turn end, idle
 * timer, and shutdown. The default recommendation is switch + idle +
 * shutdown (+ flush), per SPEC §26.
 */

import type { ResolvedKvPersistConfig } from "../config.js";
import { isDirty } from "./state-machine.js";
import type { SessionRuntime } from "./state-machine.js";

export type CheckpointTrigger =
  | "switch"
  | "idle"
  | "session-flush"
  | "session-disposed"
  | "turn-end"
  | "shutdown"
  | "manual";

/** Pure decision helper over config + runtime state. */
export class CheckpointPolicy {
  readonly #config: ResolvedKvPersistConfig;

  constructor(config: ResolvedKvPersistConfig) {
    this.#config = config;
  }

  /** True when the trigger is enabled and the session actually needs a save. */
  shouldCheckpoint(runtime: SessionRuntime | undefined, trigger: CheckpointTrigger): boolean {
    if (runtime === undefined) return false;
    if (!isDirty(runtime)) return false;
    switch (trigger) {
      case "switch":
        return this.#config.checkpoint.onSwitch;
      case "idle":
        return this.#config.checkpoint.idleMs > 0;
      case "session-flush":
        return this.#config.checkpoint.onSessionFlush;
      case "session-disposed":
        return this.#config.checkpoint.onSwitch || this.#config.checkpoint.onShutdown;
      case "turn-end":
        return this.#config.checkpoint.onTurnEnd;
      case "shutdown":
        return this.#config.checkpoint.onShutdown;
      case "manual":
        return true;
    }
  }
}
