import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";
import {
  resolvePluginConfig,
  UI_REPAIR_ROW_CONFIG_KEY,
  UI_REPAIR_SETTINGS_NAMESPACE,
  type UIRepairPluginConfig,
} from "../shared/config.js";
import { UIRepairCard, type CardFace } from "./card.js";
import { UIRepairRuntime, type ClientLogger } from "./runtime.js";
import { styles } from "./styles.js";
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
export const inject = ["slots", "configForms"];

export function apply(ctx: Context, options: ClientOptions = {}): () => void {
  const candidateDocument =
    options.document === undefined
      ? typeof document === "undefined"
        ? undefined
        : document
      : (options.document ?? undefined);
  if (candidateDocument === undefined || candidateDocument.body === null) {
    return () => undefined;
  }
  const { document: _document, logger, ...config } = options;
  const runtime = new UIRepairRuntime(candidateDocument, config, logger);
  const form = ctx.configForms.get<UIRepairPluginConfig>(
    UI_REPAIR_SETTINGS_NAMESPACE,
  );
  let started = false;
  const syncConfig = () => {
    const resolved = resolvePluginConfig(form.getSnapshot().value ?? {});
    runtime.configure({
      enabled: resolved.enabled,
      mode: resolved.mode,
      autoConfidence: resolved.autoConfidence,
      dangerousConfidence: resolved.dangerousConfidence,
      scanOnStartup: resolved.scanOnStartup,
      observeMutations: resolved.scanAfterMutation,
      observeResize: resolved.scanAfterResize,
      ignore: resolved.ignore,
    });
    if (started && resolved.enabled) {
      void runtime.scan().catch(() => undefined);
    }
  };
  syncConfig();
  const unsubscribe = form.subscribe(syncConfig);
  const removeService = ctx.provide("uiRepair", runtime);
  runtime.start();
  started = true;
  const face: CardFace = { settings: form, runtime };
  const removeStyles = injectCardStyles(name, styles);
  const removeCard = ctx.slots.inject("plugins.row.config", () =>
    ctx.slots.register(
      {
        name: "plugins.row.config",
        key: UI_REPAIR_ROW_CONFIG_KEY,
        inject: () => face,
      },
      UIRepairCard,
    ),
  );
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    removeCard();
    removeStyles();
    unsubscribe();
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
