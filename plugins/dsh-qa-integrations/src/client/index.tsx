import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import qaIntegrationsRemote from "@yadsh/dsh-qa-integrations/remote";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";
import type {
  QaUserSession,
  QaUserSettingsSections,
} from "@yadsh/dsh-qa-surface/client/settings";
import type { QaIntegrationsConfig } from "../config.js";
import type { IntegrationSummary, PolicyPatch } from "../types.js";
import { createIntegrationsHostTab } from "./card.js";
import {
  createIntegrationsPage,
  type IntegrationsClientRemote,
} from "./integrations.js";
import { OperatorCard } from "./operator-card.js";
import { styles } from "./styles.js";
import { QA_INTEGRATIONS_SETTINGS_NAMESPACE } from "../shared/settings.js";

/**
 * What this bundle reads off its client context.
 *
 * The remote registry is declared structurally and reached through one cast:
 * the gateway exposes one `ClientRemote` declaration per resolved copy of its
 * types, so a signature that names it can compile against one installed graph
 * and fail against another. The entry's own parameter stays a plain `Context`,
 * which every graph resolves the same way.
 */
interface ClientRemoteFace {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>;
  readonly qaIntegrations: IntegrationsClientRemote;
}

type ClientFace = Context & {
  readonly remote: ClientRemoteFace;
  readonly qaUserSettingsSections: QaUserSettingsSections;
  readonly qaUserSession: QaUserSession;
  readonly settingsScope: {
    bind<T>(spec: { namespace: string }): SettingsScope<T>;
  };
};

export const inject = [
  "remote",
  "qaUserSettingsSections",
  "qaUserSession",
  "settingsScope",
  "slots",
] as const;

/**
 * All three mounts of this one bundle: the operator card in the Host's
 * "Plugin configuration" tab, which edits the plugin's settings namespace, the
 * page of the signed-in user's QA settings dialog, where the account gate
 * lives, and the feature-owned tab in the host's Plugins settings, which
 * reaches the same account through the `qaUserSession` service without
 * depending on the Host settings directory.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await (ctx as ClientFace).remote.$mount(
    qaIntegrationsRemote,
  );
  try {
    await ctx.inject(
      [
        "remote.qaIntegrations",
        "qaUserSettingsSections",
        "qaUserSession",
        "settingsScope",
        "slots",
      ],
      (injected) => {
        const face = injected as ClientFace;
        let cancelled = false;
        let removeSection: (() => void) | undefined;
        let removeHostTab: (() => void) | undefined;
        face.effect(() => {
          const style = document.createElement("style");
          style.dataset.dshQaIntegrations = "styles";
          style.textContent = styles;
          document.head.append(style);
          return () => style.remove();
        }, "dsh-qa-integrations: styles");
        // The operator card does not wait for the Remote to describe the
        // deployment: an operator's first act may be enabling the plugin, and
        // the card is the surface that does it.
        const removeCard = registerSettingsCard(face, {
          key: QA_INTEGRATIONS_SETTINGS_NAMESPACE,
          pluginName: "@yadsh/dsh-qa-integrations",
          component: OperatorCard,
          inject: () => ({
            scope: face.settingsScope.bind<QaIntegrationsConfig>({
              namespace: QA_INTEGRATIONS_SETTINGS_NAMESPACE,
            }),
          }),
        });
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
          const HostTab = createIntegrationsHostTab(
            face.remote.qaIntegrations,
            providers,
            face.qaUserSession,
          );
          removeHostTab = face.slots.inject("settings.plugins.tab", () =>
            face.slots.register(
              {
                name: "settings.plugins.tab",
                id: "qa-integrations",
                order: 40,
                label: () => "Интеграции",
              },
              HostTab,
            ),
          );
        })().catch(() => undefined);
        return () => {
          cancelled = true;
          removeSection?.();
          removeHostTab?.();
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
