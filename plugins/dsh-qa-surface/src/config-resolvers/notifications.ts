import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";

type NotificationsSlice = ResolvedQaSurfaceConfig["notifications"];

/**
 * Resolve the notification domain: the deployment's two switches over the
 * notices a finished turn may raise. Which chats a notice is allowed to speak
 * about is not a configuration question — it is the browser's own chat list.
 */
export function resolveNotifications(
  input: QaSurfaceConfig,
): NotificationsSlice {
  return Object.freeze({
    enabled:
      input.notifications?.enabled ??
      DEFAULT_QA_SURFACE_CONFIG.notifications.enabled,
    allowOs:
      input.notifications?.allowOs ??
      DEFAULT_QA_SURFACE_CONFIG.notifications.allowOs,
  });
}
