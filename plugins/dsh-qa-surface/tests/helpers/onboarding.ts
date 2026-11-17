import { QA_WELCOME_NOTICE_VERSION } from "../../src/client/components/QaWelcomeNotice.js";
import { qaStorageNamespace } from "../../src/shared/session-key.js";
import type { ResolvedQaSurfaceConfig } from "../../src/types.js";

export function acknowledgeOnboarding(config: ResolvedQaSurfaceConfig): void {
  const namespace = qaStorageNamespace(config);
  window.localStorage.setItem(
    `${namespace}:welcome-notice`,
    QA_WELCOME_NOTICE_VERSION,
  );
  window.localStorage.setItem(
    `${namespace}:usage-guide`,
    config.branding.usageGuideMarkdown,
  );
}
