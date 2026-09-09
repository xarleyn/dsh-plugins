import type { Context } from "@deepseek-ai/cordis";
import { UIRepairRuntime, type ClientLogger } from "./runtime.js";
import type { UIRepairConfig, UIRepairService } from "./types.js";

export interface ClientOptions extends Partial<UIRepairConfig> {
  readonly document?: Document | null;
  readonly logger?: ClientLogger;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    uiRepair: UIRepairService;
  }
}

export const name = "dsh-ui-repair";
export const inject: readonly string[] = [];

export function apply(ctx: Context, options: ClientOptions = {}): () => void {
  const candidateDocument =
    options.document === undefined
      ? typeof document === "undefined"
        ? undefined
        : document
      : options.document ?? undefined;
  if (candidateDocument === undefined || candidateDocument.body === null) {
    return () => undefined;
  }
  const {
    document: _document,
    logger,
    ...config
  } = options;
  const runtime = new UIRepairRuntime(candidateDocument, config, logger);
  const removeService = ctx.provide("uiRepair", runtime);
  runtime.start();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    runtime.dispose();
    void removeService();
  };
}

export { DEFAULT_CONFIG, UIRepairRuntime } from "./runtime.js";
export type { ClientLogger } from "./runtime.js";
export type {
  RepairHistoryEntry,
  RepairIssue,
  RepairMode,
  ScanReport,
  UIRepairConfig,
  UIRepairService,
} from "./types.js";
