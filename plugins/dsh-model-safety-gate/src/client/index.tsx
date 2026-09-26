/**
 * Browser entry of the Safety Gate card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * mounts the generated Remote contribution and registers the card as one tab of
 * the Plugins settings section.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import safetyGateRemote from "@yadsh/dsh-model-safety-gate/remote";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";

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

/** Tab key the section seats this page under; the form is keyed by the entry id. */
const CARD_TAB_ID = "model-safety-gate";

/**
 * Client services this module reads. The 0.1.7 client runtime resolves only
 * declared dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest. `configForms` is the settings domain's base
 * service: it hands out the live form of one profile entry.
 */
export const inject = ["slots", "configForms", "remote"];

/** Mount the Remote contribution and register the card as a Plugins tab. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as unknown as ClientRemote;
  const disposeRemote = await remote.$mount(safetyGateRemote);
  const removeStyles = injectCardStyles("@yadsh/dsh-model-safety-gate", styles);
  let disposeSlot: (() => void) | undefined;
  try {
    await ctx.inject(["remote.safetyGate"], (remoteCtx) => {
      const injected = remoteCtx.remote as unknown as ClientRemote;
      // The settings namespace of a plugin is its profile entry id, so the form
      // the Host serves for this gate is keyed by that id and nothing else.
      const form = remoteCtx.configForms.get<ModelSafetyGateConfig>(
        SAFETY_GATE_SETTINGS_NAMESPACE,
      );
      const face: SafetyGateCardFace = {
        form,
        inspect: () => injected.safetyGate.inspect(),
      };
      disposeSlot = remoteCtx.slots.inject("settings.plugins.tab", () =>
        remoteCtx.slots.register(
          {
            name: "settings.plugins.tab",
            id: CARD_TAB_ID,
            // Between the two other plugin pages this section already carries
            // (domain experts 20, integrations 40).
            order: 30,
            label: () => "Model Safety Gate",
            inject: () => face,
          },
          SafetyGateCard,
        ),
      );
    });
  } catch (cause) {
    disposeSlot?.();
    removeStyles();
    await disposeRemote();
    throw cause;
  }

  return () => {
    disposeSlot?.();
    removeStyles();
    return disposeRemote();
  };
}
