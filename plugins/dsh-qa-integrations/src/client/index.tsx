import type { Context } from "@deepseek-ai/cordis";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import qaIntegrationsRemote from "@yadsh/dsh-qa-integrations/remote";
import type { QaUserSettingsSections } from "@yadsh/dsh-qa-surface/client/settings";
import type { IntegrationSummary, PolicyPatch } from "../types.js";
import { createBitrix24Page, type IntegrationsRemote } from "./bitrix24.js";
import { styles } from "./styles.js";

interface ClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>;
  qaIntegrations: IntegrationsRemote;
}

interface ClientContext extends Context {
  readonly remote: ClientRemote;
  readonly qaUserSettingsSections: QaUserSettingsSections;
}

export const inject = ["remote", "qaUserSettingsSections"] as const;

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(qaIntegrationsRemote);
  let removeSection: (() => void) | undefined;
  let style: HTMLStyleElement | undefined;
  let stopped = false;
  let generation = 0;
  try {
    await ctx.inject(
      ["remote.qaIntegrations", "qaUserSettingsSections"],
      (injected) => {
        const face = injected as ClientContext;
        const current = ++generation;
        removeSection?.();
        removeSection = undefined;
        style?.remove();
        style = undefined;
        void (async () => {
          const description = await face.remote.qaIntegrations.describe();
          if (
            stopped ||
            current !== generation ||
            !description.ok ||
            !description.value.enabled
          ) {
            return;
          }
          style = document.createElement("style");
          style.dataset.dshQaIntegrations = "styles";
          style.textContent = styles;
          document.head.append(style);
          removeSection = face.qaUserSettingsSections.register({
            id: "integrations",
            title: "Интеграции",
            order: 40,
            component: createBitrix24Page(face.remote.qaIntegrations),
          });
        })().catch(() => undefined);
      },
    );
  } catch (error) {
    await disposeRemote();
    throw error;
  }
  return async () => {
    stopped = true;
    generation += 1;
    removeSection?.();
    style?.remove();
    await disposeRemote();
  };
}

export type { IntegrationSummary, PolicyPatch, RemoteResult };
