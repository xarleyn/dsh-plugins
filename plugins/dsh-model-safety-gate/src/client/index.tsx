/**
 * Browser entry of the Safety Gate card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * mounts the generated Remote contribution and registers the card in the
 * shared settings-plugins slot.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type { RemoteResult, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import safetyGateRemote from "@yadsh/dsh-model-safety-gate/remote";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";

import type { ModelSafetyGateConfig } from "../config.js";
import type { SafetyGateInspect } from "../types.js";
import { SAFETY_GATE_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { SafetyGateCard, type SafetyGateCardFace } from "./card.js";
import { styles } from "./styles.js";

/** The mounted `safetyGate` namespace as the gateway exposes it. */
interface SafetyGateRemote {
  inspect(): Promise<RemoteResult<SafetyGateInspect>>;
}

interface ClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>;
  safetyGate: SafetyGateRemote;
}

/**
 * Client services this module reads. The 0.1.5 client runtime resolves only
 * declared dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest.
 */
export const inject = ["slots", "settingsScope", "remote"];

/** Mount the Remote contribution and register the native settings card. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as unknown as ClientRemote;
  const disposeRemote = await remote.$mount(safetyGateRemote);
  try {
    await ctx.inject(["remote.safetyGate"], (remoteCtx) => {
      const injected = remoteCtx.remote as unknown as ClientRemote;
      const scope = remoteCtx.settingsScope.bind<ModelSafetyGateConfig>({
        namespace: SAFETY_GATE_SETTINGS_NAMESPACE,
      });
      const face: SafetyGateCardFace = {
        scope,
        inspect: () => injected.safetyGate.inspect(),
      };

      return registerSettingsCard(remoteCtx, {
        key: SAFETY_GATE_SETTINGS_NAMESPACE,
        pluginName: "@yadsh/dsh-model-safety-gate",
        styles,
        component: SafetyGateCard,
        inject: () => face,
      });
    });
  } catch (cause) {
    await disposeRemote();
    throw cause;
  }

  return disposeRemote;
}
