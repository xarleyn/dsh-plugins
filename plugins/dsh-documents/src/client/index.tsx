/**
 * Browser entry of the documents card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name as `id`) is produced by the tsdown banner; this
 * module registers the card as a tab of the Plugins settings page. The tab key
 * is the settings namespace, which on this host *is* the profile entry id
 * `documents` — the same string the Host serves the form under, so the two halves
 * join without either naming the other.
 *
 * No Remote is mounted: the card edits configuration and nothing else, so it
 * needs the settings form alone.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";

import type { DocumentsConfig } from "../documents/config.js";
import { DOCUMENTS_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { DocumentsCard, type DocumentsCardFace } from "./card.js";
import { styles } from "./styles.js";

/**
 * Client services this module reads. The client runtime resolves only declared
 * dependencies, so they must be listed here as well as in the `dsh.client.inject`
 * manifest.
 */
export const inject = ["slots", "configForms"];

/**
 * Register the settings tab under the plugin's namespace. The injected
 * fiber owns the registration's lifetime, so nothing is returned here.
 */
export async function apply(ctx: Context): Promise<void> {
  const removeStyles = injectCardStyles("@yadsh/dsh-documents", styles);
  ctx.effect(() => removeStyles, "dsh-documents.card-styles");
  await ctx.inject(["configForms"], (formCtx) => {
    const form = formCtx.configForms.get<DocumentsConfig>(
      DOCUMENTS_SETTINGS_NAMESPACE,
    );
    const face: DocumentsCardFace = { form };
    return ctx.slots.inject("settings.plugins.tab", () =>
      ctx.slots.register(
        {
          name: "settings.plugins.tab",
          id: DOCUMENTS_SETTINGS_NAMESPACE,
          order: 30,
          label: () => "Документы",
          inject: () => face,
        },
        DocumentsCard,
      ),
    );
  });
}
