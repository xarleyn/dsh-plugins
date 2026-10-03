import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import qaIntegrationsRemote from "@yadsh/dsh-qa-integrations/remote";
import type {
  QaUserSession,
  QaUserSettingsSections,
} from "@yadsh/dsh-qa-surface/client/settings";
import type { QaIntegrationsConfig } from "../config.js";
import type { IntegrationSummary, PolicyPatch } from "../types.js";
import { createIntegrationsCard } from "./card.js";
import {
  createIntegrationsPage,
  type IntegrationsClientRemote,
} from "./integrations.js";
import { OperatorCardEntry } from "./operator-card.js";
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
};

export const inject = [
  "remote",
  "qaUserSettingsSections",
  "qaUserSession",
  "configForms",
  "slots",
] as const;

/**
 * All three mounts of this one bundle: the operator card, which edits the
 * plugin's own profile entry through the settings form the Host serves for it,
 * the page of the signed-in user's QA settings dialog, where the account gate
 * lives, and the account card the Plugins page shows on this bundle's own page,
 * which reaches the same account through the `qaUserSession` service.
 *
 * The two panel cards draw the body only — the page supplies their frame, title
 * and expand control. What they leave behind is the Settings *surface*: neither
 * needs the settings directory (loopback-only, and the card keeps answering from
 * a browser on the LAN) nor a tab of the Settings dialog. What neither can drop
 * is the settings *service*: `configForms` is
 * `@deepseek-ai/dsh-client-ui-settings`, which stays a peer, an injection and a
 * documented dependency (`docs/COMPATIBILITY.md`) — a seat decides where the card
 * renders, not which module hands it a form.
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
        "configForms",
        "slots",
      ],
      (injected) => {
        const face = injected as ClientFace;
        let cancelled = false;
        let removeSection: (() => void) | undefined;
        let removeBundleCard: (() => void) | undefined;
        face.effect(() => {
          const style = document.createElement("style");
          style.dataset.dshQaIntegrations = "styles";
          style.textContent = styles;
          document.head.append(style);
          return () => style.remove();
        }, "dsh-qa-integrations: styles");
        // The operator card edits this plugin's own entry, which the Host
        // serves as soon as the entry exists — it does not wait for the Remote
        // to describe the deployment, because an operator's first act may be
        // enabling the plugin, and the card is the surface that does it.
        const removeCard = face.configForms.whileServed(
          [QA_INTEGRATIONS_SETTINGS_NAMESPACE],
          () =>
            face.slots.inject("plugins.row.config", () =>
              face.slots.register(
                {
                  name: "plugins.row.config",
                  key: "@yadsh/dsh-qa-integrations#qa-integrations",
                  // The seat hands the page's own `ConfigPageForm` — `{ state,
                  // mutate }` only — so the card edits the full form this entry
                  // resolves, under a name the owner prop cannot overwrite.
                  inject: () => ({
                    settingsForm: face.configForms.get<QaIntegrationsConfig>(
                      QA_INTEGRATIONS_SETTINGS_NAMESPACE,
                    ),
                  }),
                },
                OperatorCardEntry,
              ),
            ),
        );
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
          const BundleCard = createIntegrationsCard(
            face.remote.qaIntegrations,
            providers,
            face.qaUserSession,
          );
          removeBundleCard = face.slots.inject("plugins.bundle.config", () =>
            face.slots.register(
              {
                name: "plugins.bundle.config",
                key: "@yadsh/dsh-qa-integrations",
              },
              BundleCard,
            ),
          );
        })().catch(() => undefined);
        return () => {
          cancelled = true;
          removeSection?.();
          removeBundleCard?.();
          removeCard();
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
