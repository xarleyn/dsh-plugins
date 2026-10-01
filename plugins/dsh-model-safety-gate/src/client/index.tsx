/**
 * Browser entry of the Safety Gate card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * mounts the generated Remote contribution and registers the card as the
 * configuration of this bundle's own row on the Plugins page.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import safetyGateRemote from "@yadsh/dsh-model-safety-gate/remote";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";

import type { ModelSafetyGateConfig } from "../config.js";
import type { SafetyGateInspect } from "../types.js";
import { SAFETY_GATE_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { SafetyGateEntry, type SafetyGateCardFace } from "./card.js";
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
 * The seat this card takes on the host Plugins page: `plugins.row.config` is
 * keyed by the bundle's package name joined to the row id its
 * `cordis.patch.yml` declares, and that row id is the very string the settings
 * namespace is, so a value saved before this seat existed still reads back.
 */
const ROW_CONFIG_KEY = `@yadsh/dsh-model-safety-gate#${SAFETY_GATE_SETTINGS_NAMESPACE}`;

/**
 * Client services this module reads. The 0.1.7 client runtime resolves only
 * declared dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest. `configForms` is the settings domain's base
 * service: it hands out the live form of one profile entry.
 */
export const inject = ["slots", "configForms", "remote"];

/** Mount the Remote contribution and register the card on this bundle's row page. */
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
      // The row seat hands a `ConfigPageForm` for the same namespace, but that
      // view is `{ state, mutate }` only — it cannot be subscribed to and
      // writes no single field — so the card resolves its own form here.
      const form = remoteCtx.configForms.get<ModelSafetyGateConfig>(
        SAFETY_GATE_SETTINGS_NAMESPACE,
      );
      const face: SafetyGateCardFace = {
        settingsForm: form,
        inspect: () => injected.safetyGate.inspect(),
      };
      disposeSlot = remoteCtx.slots.inject("plugins.row.config", () =>
        remoteCtx.slots.register(
          {
            name: "plugins.row.config",
            key: ROW_CONFIG_KEY,
            inject: () => face,
          },
          SafetyGateEntry,
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
