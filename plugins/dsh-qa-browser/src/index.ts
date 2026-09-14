import type { Context } from "@deepseek-ai/cordis";

import { QaBrowserConfigSchema } from "./config.js";
import { QaBrowserService } from "./host/service.js";

export const name = "dsh-qa-browser";
export const inject = ["agents", "tools"] as const;
export const Config = QaBrowserConfigSchema;

declare module "@deepseek-ai/cordis" {
  interface Context {
    qaBrowser: QaBrowserService;
  }
}

export function apply(
  ctx: Context,
  config: ConstructorParameters<typeof QaBrowserService>[1],
): QaBrowserService {
  return new QaBrowserService(ctx, config);
}

export {
  QA_BROWSER_DEFAULTS,
  QaBrowserConfigSchema,
  resolveQaBrowserConfig,
  type QaBrowserConfig,
  type ResolvedQaBrowserConfig,
} from "./config.js";
export { QaBrowserError, type QaBrowserErrorCode } from "./errors.js";
export { BrowserNetworkPolicy } from "./host/policy.js";
export type {
  BrowserContextHandle,
  BrowserContextOptions,
  BrowserPageHandle,
  BrowserProvider,
  BrowserProviderStartOptions,
} from "./host/providers/contract.js";
export { PlaywrightBrowserProvider } from "./host/providers/playwright.js";
export {
  QaBrowserSessionManager,
  silentBrowserLogger,
  type BrowserRuntimeLogger,
  type QaBrowserSessionManagerOptions,
} from "./host/session-manager.js";
export {
  BROWSER_CORE_TOOL_NAMES,
  createBrowserCoreTools,
} from "./host/tools/index.js";
export {
  QaBrowserService,
  type QaBrowserServiceDependencies,
} from "./host/service.js";
export type * from "./types.js";

export default QaBrowserService;
