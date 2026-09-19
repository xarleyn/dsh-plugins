/**
 * Browser entry of the OpenViking Memory settings card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * binds the plugin's settings namespace and registers the card in the shared
 * settings-plugins slot.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";

import type { Config } from "../config.js";
import { OPENVIKING_MEMORY_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { OpenVikingMemoryCard } from "./card.js";
import { styles } from "./styles.js";

/**
 * Client services this module reads. The 0.1.5 client runtime resolves only
 * declared dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest.
 */
export const inject = ["slots", "settingsScope"];

function noop(): void {}

/** Bind the settings namespace and register the native settings card. */
export function apply(ctx: Context): () => void {
  const settingsScope = ctx.settingsScope;
  // Headless probes and older profiles may lack the binder; rendering no card
  // beats crashing the page during module load.
  if (
    settingsScope === undefined ||
    typeof settingsScope.bind !== "function" ||
    ctx.slots === undefined
  ) {
    return noop;
  }

  const scope = settingsScope.bind<Config>({
    namespace: OPENVIKING_MEMORY_SETTINGS_NAMESPACE,
  });

  return registerSettingsCard(ctx, {
    key: OPENVIKING_MEMORY_SETTINGS_NAMESPACE,
    pluginName: "@yadsh/dsh-openviking-memory",
    styles,
    component: OpenVikingMemoryCard,
    inject: () => ({ scope }),
  });
}
