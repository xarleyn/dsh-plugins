/**
 * Browser entry of the documents card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name as `id`) is produced by the tsdown banner; this
 * module registers the card as the configuration of this bundle's own row on the
 * Plugins page. The seat key joins the package name to the row id
 * `cordis.patch.yml` declares, and that row id *is* the settings namespace the
 * Host serves this form under, so the two halves join without either naming the
 * other and a value saved before the move is read back after it.
 *
 * No Remote is mounted: the card edits configuration and nothing else, so it
 * needs the settings form alone.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";
import type { ReactElement } from "react";

import type { DocumentsConfig } from "../documents/config.js";
import { DOCUMENTS_SETTINGS_NAMESPACE } from "../shared/settings.js";
import {
  DOCUMENTS_CARD_SUMMARY,
  DocumentsCard,
  type DocumentsCardFace,
  type DocumentsCardProps,
} from "./card.js";
import { styles } from "./styles.js";

/**
 * Client services this module reads. The client runtime resolves only declared
 * dependencies, so they must be listed here as well as in the `dsh.client.inject`
 * manifest.
 */
export const inject = ["slots", "configForms"];

/**
 * The seat the card takes on the Plugins page: `plugins.row.config` is keyed by
 * the bundle's package name joined to a row id its `cordis.patch.yml` declares.
 * The row id here is also the settings namespace, which is what keeps the stored
 * values of a live stand readable after the move.
 */
const ROW_CONFIG_KEY = `@yadsh/dsh-documents#${DOCUMENTS_SETTINGS_NAMESPACE}`;

/**
 * The entry the Plugins page renders for this bundle's row.
 *
 * The page renders this entry as the `page` body, and asks it for `view:
 * 'summary'` as the row's one-liner only when the row carries no display
 * description — the page takes that from this package's exported locale `meta`
 * (`locale/en.json`), which the Host reads without activating the plugin. The
 * summary lands inside the page's own description paragraph and therefore stays
 * text: without this branch a row that lost its description would be handed a
 * whole card. The `page` view is the body alone — the panel draws the frame, the
 * heading and the expand control around it (AGENTS.md).
 */
function DocumentsSettingsEntry(
  props: DocumentsCardProps,
): ReactElement | string {
  if (props.view === "summary") return DOCUMENTS_CARD_SUMMARY;
  return <DocumentsCard {...props} />;
}

/**
 * Register the card as this row's configuration. The injected fiber owns the
 * registration's lifetime, so nothing is returned here.
 */
export async function apply(ctx: Context): Promise<void> {
  const removeStyles = injectCardStyles("@yadsh/dsh-documents", styles);
  ctx.effect(() => removeStyles, "dsh-documents.card-styles");
  await ctx.inject(["configForms"], (formCtx) => {
    // The row seat hands the page's own `ConfigPageForm`, which is `{ state,
    // mutate }` alone: it cannot be subscribed to and writes no single field. So
    // the card edits the live `ConfigForm` resolved for this plugin's namespace,
    // and that form arrives through the injected face, under a name the owner
    // prop `form` cannot shadow.
    const form = formCtx.configForms.get<DocumentsConfig>(
      DOCUMENTS_SETTINGS_NAMESPACE,
    );
    const face: DocumentsCardFace = { settingsForm: form };
    return ctx.slots.inject("plugins.row.config", () =>
      ctx.slots.register(
        {
          name: "plugins.row.config",
          key: ROW_CONFIG_KEY,
          inject: () => face,
        },
        DocumentsSettingsEntry,
      ),
    );
  });
}
