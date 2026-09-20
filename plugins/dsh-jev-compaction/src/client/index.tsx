/**
 * Browser entry of the Jev Compaction settings card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * binds the plugin's settings namespace and registers the card in the shared
 * `settings.plugin.item` slot. Everything the card shows comes from the
 * settings scope, so the plugin needs no Remote namespace — and no API secret
 * ever crosses to the browser: the card edits the *name* of the environment
 * variable holding the key and only displays whether the Host can resolve it.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";

import { JEV_COMPACTION_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { JevCompactionCard } from "./card.js";
import { styles } from "./styles.js";

/** Package name: the style-tag key and the card's own plugin identity. */
export const CLIENT_PLUGIN_NAME = "@yadsh/dsh-jev-compaction";

/**
 * Client services this module reads. The client runtime resolves only
 * declared dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest.
 */
export const inject = ["slots", "settingsScope"];

function noop(): void {}

/** Structural view of the client context this entry needs. */
interface ClientFace {
  readonly slots: {
    inject(slotName: string, factory: () => unknown): () => void;
    register(options: unknown, component: unknown): () => void;
  };
  readonly settingsScope: {
    bind(spec: { namespace: string }): unknown;
  };
}

/** Bind the settings namespace and register the native settings card. */
export function apply(ctx: Context): () => void {
  const face = ctx as unknown as Partial<ClientFace>;
  // Headless probes and older profiles may lack the binder; rendering no card
  // beats crashing the page during module load (AGENTS.md: no namespace, no
  // card).
  if (
    face.settingsScope === undefined ||
    typeof face.settingsScope.bind !== "function" ||
    face.slots === undefined
  ) {
    return noop;
  }

  const scope = face.settingsScope.bind({
    namespace: JEV_COMPACTION_SETTINGS_NAMESPACE,
  });

  return registerSettingsCard(face as never, {
    key: JEV_COMPACTION_SETTINGS_NAMESPACE,
    pluginName: CLIENT_PLUGIN_NAME,
    styles,
    component: JevCompactionCard,
    inject: () => ({ scope }),
  });
}
