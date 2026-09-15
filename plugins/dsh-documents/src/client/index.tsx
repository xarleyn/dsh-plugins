/**
 * Browser entry of the documents card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name as `id`) is produced by the tsdown banner; this
 * module registers the card in the shared `settings.plugin.item` slot, keyed by
 * the settings namespace the Host installs.
 *
 * No Remote is mounted: the card edits configuration and nothing else, so it
 * needs the settings scope alone.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";

import type { DocumentsConfig } from "../documents/config.js";
import { DOCUMENTS_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { DocumentsCard, type DocumentsCardFace } from "./card.js";
import { styles } from "./styles.js";

/**
 * Client services this module reads. The client runtime resolves only declared
 * dependencies, so they must be listed here as well as in the `dsh.client.inject`
 * manifest.
 */
export const inject = ["slots", "settingsScope"];

/**
 * Register the native settings card under the plugin's namespace. The injected
 * fiber owns the registration's lifetime, so nothing is returned here.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.inject(["settingsScope"], (scopeCtx) => {
    const scope = scopeCtx.settingsScope.bind<DocumentsConfig>({
      namespace: DOCUMENTS_SETTINGS_NAMESPACE,
    });
    const face: DocumentsCardFace = { scope };
    return registerSettingsCard(scopeCtx, {
      key: DOCUMENTS_SETTINGS_NAMESPACE,
      pluginName: "@yadsh/dsh-documents",
      styles,
      component: DocumentsCard,
      inject: () => face,
    });
  });
}
