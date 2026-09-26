/**
 * Browser entry of the Jev Compaction settings card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * resolves the Host form for the plugin's own configuration section and mounts
 * the card as a tab of the Plugins page. Everything the card shows comes from
 * that form, so the plugin needs no Remote namespace — and no API key ever
 * crosses to the browser: the card edits the *name* of the environment variable
 * holding the key and only displays whether the Host can resolve it.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";

import type { JevCompactionConfig } from "../config.js";
import { JEV_COMPACTION_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { JevCompactionCard } from "./card.js";
import { styles } from "./styles.js";

/** Package name: the style-tag key and the card's own plugin identity. */
export const CLIENT_PLUGIN_NAME = "@yadsh/dsh-jev-compaction";

/**
 * The slot this card occupies. `settings.plugin.item` was removed with the
 * 0.1.7 settings rewrite; a plugin-owned configuration page now sits in the
 * Plugins section as a tab, which is also what keeps the card reachable from a
 * non-loopback browser.
 */
export const SETTINGS_CARD_SLOT = "settings.plugins.tab";

/** Tab position among the contributed Plugins tabs. */
const TAB_ORDER = 30;

/**
 * Client services this module reads. The client runtime resolves only
 * declared dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest.
 */
export const inject = ["slots", "configForms"];

function noop(): void {}

/** Structural view of the client context this entry needs. */
interface ClientFace {
  readonly slots: {
    inject(slotName: string, factory: () => unknown): () => void;
    register(options: unknown, component: unknown): () => void;
  };
  readonly configForms?: {
    get<T>(entryId: string): T;
  };
}

/** Resolve the settings form and register the card as a Plugins tab. */
export function apply(ctx: Context): () => void {
  const face = ctx as unknown as Partial<ClientFace>;
  const slots = face.slots;
  // Headless probes and profiles without the settings client have no form to
  // bind; rendering no card beats crashing the page during module load
  // (AGENTS.md: no namespace, no card).
  if (
    face.configForms === undefined ||
    typeof face.configForms.get !== "function" ||
    slots === undefined
  ) {
    return noop;
  }

  // The tab slot hands a card nothing, so the entry id is the join key into the
  // Host settings document (`../shared/settings.ts`).
  const form = face.configForms.get<JevCompactionConfig>(
    JEV_COMPACTION_SETTINGS_NAMESPACE,
  );
  const removeStyles = injectCardStyles(CLIENT_PLUGIN_NAME, styles);
  const disposeSlot = slots.inject(SETTINGS_CARD_SLOT, () =>
    slots.register(
      {
        name: SETTINGS_CARD_SLOT,
        id: JEV_COMPACTION_SETTINGS_NAMESPACE,
        order: TAB_ORDER,
        label: () => "Jev Compaction",
        inject: () => ({ form }),
      },
      JevCompactionCard,
    ),
  );

  return () => {
    disposeSlot();
    removeStyles();
  };
}
