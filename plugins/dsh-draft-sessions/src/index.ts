import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import { DEFAULT_MAX_DRAFTS_PER_WORKSPACE } from "./shared/constants.js";
import type {
  CreateDraftRequest,
  DeleteDraftRequest,
  DeleteDraftResult,
  DraftSession,
  ListDraftsRequest,
  RebindDraftRequest,
  UpdateDraftRequest,
} from "./shared/types.js";
import { DraftStore } from "./host/store.js";

export interface Config {
  /** Absolute or cwd-relative JSON storage path; blank uses $DSH_HOME. */
  readonly storagePath?: string;
  /** Per-workspace safety limit. */
  readonly maxDraftsPerWorkspace?: number;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    draftSessions: DraftSessionsService;
  }
}

/** Host service and Typert Remote boundary for persistent draft records. */
export class DraftSessionsService extends TypertRemoteService {
  static Config: z<Config> = z.object({
    storagePath: z.string().default(""),
    maxDraftsPerWorkspace: z.number().default(DEFAULT_MAX_DRAFTS_PER_WORKSPACE),
  });

  readonly store: DraftStore;
  private readonly logger: PluginLogger;

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, "draftSessions");
    const rootLogger = getPluginLogger({
      pluginId: "dsh-draft-sessions",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    this.logger = rootLogger.child("store");
    ctx.effect(
      () => async () => rootLogger.close(),
      "dsh-draft-sessions.logger",
    );
    this.store = new DraftStore({
      ...(config.storagePath === undefined || config.storagePath.trim() === ""
        ? {}
        : { storagePath: config.storagePath }),
      maxDraftsPerWorkspace:
        config.maxDraftsPerWorkspace ?? DEFAULT_MAX_DRAFTS_PER_WORKSPACE,
    });
    rootLogger.info("plugin.ready", {
      maxDraftsPerWorkspace: this.store.maxDraftsPerWorkspace,
    });
  }

  async list(request: ListDraftsRequest): Promise<DraftSession[]> {
    const drafts = await this.store.list(request);
    this.logger.debug("draft.listed", { count: drafts.length });
    return drafts;
  }

  async create(request: CreateDraftRequest): Promise<DraftSession> {
    const draft = await this.store.create(request);
    this.logger.info("draft.created", { state: draft.state });
    return draft;
  }

  async update(request: UpdateDraftRequest): Promise<DraftSession> {
    const draft = await this.store.update(request);
    this.logger.info("draft.updated", { revision: draft.revision, state: draft.state });
    return draft;
  }

  async delete(request: DeleteDraftRequest): Promise<DeleteDraftResult> {
    const deleted = await this.store.delete(request);
    this.logger.info("draft.deleted", { deleted });
    return { deleted };
  }

  async rebind(request: RebindDraftRequest): Promise<DraftSession> {
    const draft = await this.store.rebind(request);
    this.logger.info("draft.rebound", {
      bound: draft.sessionId !== null,
      revision: draft.revision,
    });
    return draft;
  }
}

type RemoteMethod = "list" | "create" | "update" | "delete" | "rebind";

/**
 * Apply the standard Remote decorator without shipping decorator syntax.
 *
 * Out-of-tree tsdown builds currently preserve standard decorators even when
 * targeting Node 22. Invoking the public decorator protocol here records the
 * same class markers while keeping the published JavaScript executable.
 */
function registerRemoteMethod(method: RemoteMethod): void {
  const initializers: Array<(this: object) => void> = [];
  const decorate = Remote as unknown as (
    value: (...args: unknown[]) => unknown,
    context: {
      readonly name: string;
      readonly private: boolean;
      readonly static: boolean;
      addInitializer(initializer: (this: object) => void): void;
    },
  ) => void;
  decorate(
    DraftSessionsService.prototype[method] as unknown as (
      ...args: unknown[]
    ) => unknown,
    {
      name: method,
      private: false,
      static: false,
      addInitializer(initializer) {
        initializers.push(initializer);
      },
    },
  );
  const markerReceiver = Object.create(
    DraftSessionsService.prototype,
  ) as object;
  for (const initializer of initializers) initializer.call(markerReceiver);
}

for (const method of [
  "list",
  "create",
  "update",
  "delete",
  "rebind",
] as const) {
  registerRemoteMethod(method);
}

export { DraftStoreError } from "./host/errors.js";
export { DraftStore } from "./host/store.js";
export * from "./shared/constants.js";
export * from "./shared/types.js";

export default DraftSessionsService;
