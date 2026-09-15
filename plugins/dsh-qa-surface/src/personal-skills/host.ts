import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { ResolvedQaSurfaceConfig } from "../types.js";
import { createQaUserSkillProvider } from "./provider.js";
import { QaPersonalSkills } from "./service.js";
import { QaSkillWatcher } from "./watcher.js";

export interface QaPersonalSkillsHostOptions {
  readonly ctx: Context;
  readonly getConfig: () => ResolvedQaSurfaceConfig;
  readonly logger: PluginLogger;
}

/**
 * Host owner of the personal-skills feature: the storage service, the DSH
 * provider registration and the manual-edit watcher.
 *
 * The three are one unit because they share a single liveness contract — every
 * write through the service, and every filesystem event the watcher observes,
 * invalidates the same provider registration, so the catalog the model reads
 * and the catalog the editor writes cannot drift apart. The provider is
 * registered through `ctx.inject`, so a deployment without the skills service
 * keeps the editor working and simply publishes nothing to DSH.
 */
export class QaPersonalSkillsHost {
  readonly service: QaPersonalSkills;
  private readonly watcher: QaSkillWatcher;
  private readonly options: QaPersonalSkillsHostOptions;
  /**
   * The registry's own invalidation callback, guarded by registration
   * identity on its side: a reference kept past disposal is a no-op.
   */
  private invalidateCatalog: (() => void) | undefined;
  private disposeRegistration: (() => void) | undefined;

  constructor(options: QaPersonalSkillsHostOptions) {
    this.options = options;
    const { ctx, logger } = options;
    this.watcher = new QaSkillWatcher({
      onChange: () => this.invalidateCatalog?.(),
      onError: (message) => logger.warn("skill.watch-failed", { message }),
    });
    this.service = new QaPersonalSkills(ctx, {
      getConfig: options.getConfig,
      logger,
      workspacePath: () => this.registeredWorkspacePath(),
      invalidate: () => this.invalidateCatalog?.(),
      onRootDiscovered: (root) => {
        if (!options.getConfig().accounts.skills.watch) return;
        this.watcher.follow(root);
      },
    });
    ctx.inject(["skills"], (skillsCtx) => {
      const registration = skillsCtx.skills.registerProvider((control) => {
        this.invalidateCatalog = control.invalidate;
        return createQaUserSkillProvider(control, this.service);
      });
      this.disposeRegistration = registration;
      skillsCtx.effect(
        () => () => {
          registration();
          this.disposeRegistration = undefined;
          this.invalidateCatalog = undefined;
        },
        "dsh-qa-surface.personal-skills-provider",
      );
    });
  }

  /** Whether the DSH registry currently owns this deployment's provider. */
  get registered(): boolean {
    return this.disposeRegistration !== undefined;
  }

  dispose(): void {
    this.watcher.dispose();
    this.disposeRegistration?.();
    this.disposeRegistration = undefined;
    this.invalidateCatalog = undefined;
  }

  /**
   * The registered workspace path the per-account directories live under.
   * Resolved per call: a deployment may register the workspace after this
   * plugin loads.
   */
  private registeredWorkspacePath(): string | undefined {
    const workspaceId = this.options.getConfig().session.workspaceId;
    if (workspaceId === null) return undefined;
    return this.options.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
      ?.path;
  }
}
