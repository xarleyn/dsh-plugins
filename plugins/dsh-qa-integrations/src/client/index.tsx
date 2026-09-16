import type { Context } from "@deepseek-ai/cordis";
import type { ClientRemote } from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import qaIntegrationsRemote from "@yadsh/dsh-qa-integrations/remote";
import type {
  QaUserSession,
  QaUserSettingsSections,
} from "@yadsh/dsh-qa-surface/client/settings";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";
import { QA_INTEGRATIONS_SETTINGS_NAMESPACE } from "../shared/settings.js";
import type { IntegrationSummary, PolicyPatch } from "../types.js";
import { createIntegrationsCard } from "./card.js";
import {
  createIntegrationsPage,
  type IntegrationsClientRemote,
} from "./integrations.js";
import { styles } from "./styles.js";

interface ClientContext extends Context {
  readonly remote: ClientRemote & {
    readonly qaIntegrations: IntegrationsClientRemote;
  };
  readonly qaUserSettingsSections: QaUserSettingsSections;
  readonly qaUserSession: QaUserSession;
}

export const inject = [
  "remote",
  "qaUserSettingsSections",
  "qaUserSession",
  "slots",
] as const;

/**
 * Both mounts of the provider cards come from this one bundle: the page of the
 * signed-in user's QA settings dialog, where the account gate lives, and the
 * card of the host's "Plugin configuration" tab, which reaches the same account
 * through the `qaUserSession` service.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(qaIntegrationsRemote);
  try {
    await ctx.inject(
      [
        "remote.qaIntegrations",
        "qaUserSettingsSections",
        "qaUserSession",
        "slots",
      ],
      (injected) => {
        const face = injected as ClientContext;
        let cancelled = false;
        let removeSection: (() => void) | undefined;
        let removeCard: (() => void) | undefined;
        face.effect(() => {
          const style = document.createElement("style");
          style.dataset.dshQaIntegrations = "styles";
          style.textContent = styles;
          document.head.append(style);
          return () => style.remove();
        }, "dsh-qa-integrations: styles");
        void (async () => {
          const description = await face.remote.qaIntegrations.describe();
          if (cancelled || !description.ok || !description.value.enabled) {
            return;
          }
          const providers = description.value.providers;
          removeSection = face.qaUserSettingsSections.register({
            id: "integrations",
            title: "Интеграции",
            order: 40,
            component: createIntegrationsPage(
              face.remote.qaIntegrations,
              providers,
            ),
          });
          removeCard = registerSettingsCard(face, {
            key: QA_INTEGRATIONS_SETTINGS_NAMESPACE,
            component: createIntegrationsCard(
              face.remote.qaIntegrations,
              providers,
              face.qaUserSession,
            ),
          });
        })().catch(() => undefined);
        return () => {
          cancelled = true;
          removeSection?.();
          removeCard?.();
        };
      },
    );
  } catch (error) {
    await disposeRemote();
    throw error;
  }
  return async () => {
    await disposeRemote();
  };
}

export type { IntegrationSummary, PolicyPatch, RemoteResult };
