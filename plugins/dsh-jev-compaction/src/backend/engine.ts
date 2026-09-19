/**
 * Backend-mode compaction engine (SPEC §6.6, §38 Track B): the plugin
 * provides `ctx.compaction` by extending `BasicCompactionEngine`, so
 * `/compact` (`dsh-command-compact`), overflow recovery, the deterministic
 * size pruner, the compaction event protocol, and balanced summary-range
 * selection are all inherited, while semantic Jev pruning runs earlier.
 *
 * Composition inside one mounted engine:
 *
 * ```text
 * agent/pre-step (waterfall, per step)
 *   ├─ nested JevCompactionService (prepended listener)
 *   │     armed /jev-compact plan → applies in the open turn
 *   │     auto semantic prune at trigger.contextRatio (jevPruneRatio)
 *   └─ inherited basic listener
 *         compactIfNeeded at summaryRatio → optional size pruner → summary
 * ```
 *
 * Deployment: mount this entry instead of `@deepseek-ai/dsh-compaction-basic`
 * (exactly one engine may claim the `compaction` service). The companion
 * "." entry stays available for the side-by-side mode (§6.6).
 */

import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { JevCompactionService } from "../service.js";
import type { SystemOneBackend } from "../jev/types.js";
import {
  resolveJevEngineConfig,
  type JevEngineConfig,
  type ResolvedJevEngineParts,
} from "./config.js";

export class JevCompactionEngine extends BasicCompactionEngine {
  /**
   * Deliberately `z.any()`: the inherited basic schema would strip the
   * companion sections (`decision`, `trigger`, …) from the profile config
   * before this constructor runs. Validation happens strictly in
   * `resolveJevEngineConfig` and fails the mount on bad values.
   */
  static override Config: z<JevEngineConfig> = z.any() as z<JevEngineConfig>;

  /** Engine-level configuration (summary threshold, auto listeners). */
  readonly engineConfig: ResolvedJevEngineParts["engine"];

  /** The nested early-prune service (auto semantic prune, armed plans, `/jev-compact`). */
  readonly prune: JevCompactionService;

  constructor(
    ctx: Context,
    config: JevEngineConfig = {},
    backend?: SystemOneBackend,
  ) {
    const resolved = resolveJevEngineConfig(config);
    super(ctx, resolved.basic);
    this.engineConfig = resolved.engine;
    // Nested, not inherited: the companion service owns the prepended
    // pre-step listener, the per-session mutex/cooldown, the armed-plan
    // queue, and the /jev-compact command. Everything it registers is scoped
    // to the same fiber as this engine, so teardown stays symmetric. The
    // optional backend is the test seam (production wires the System One
    // client from the resolved config).
    this.prune = new JevCompactionService(ctx, resolved.companionRaw, backend);
  }
}

export default JevCompactionEngine;
