/**
 * Browser entry of the OpenViking Memory settings surfaces.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * registers the configuration page the operator edits (the configuration section
 * of this bundle's own row on the Plugins page, bound to this entry's own
 * settings namespace), and — where a QA surface is mounted — the account-scoped
 * page that a browser reaching the deployment over the network can actually open,
 * which shows what the memory holds about the account.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";
import type { QaUserSettingsSections } from "@yadsh/dsh-qa-surface/client/settings";
import openvikingMemoryRemote from "@yadsh/dsh-openviking-memory/remote";

import type { Config } from "../config.js";
import { OPENVIKING_MEMORY_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { OpenVikingMemoryCardEntry } from "./card.js";
import {
  QA_MEMORY_SECTION_ID,
  QA_MEMORY_SECTION_TITLE,
  createMemoryOverviewSection,
  qaSettingsStyles,
  type MemoryOverviewRemote,
} from "./qa-settings.js";
import { styles } from "./styles.js";

/**
 * Client services this module reads. The client runtime resolves only declared
 * dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest.
 *
 * `configForms` is the settings domain's base service: it turns a Host profile
 * entry's volatile configuration into the form this plugin's card edits. The
 * Remote gateway and the QA services are deliberately *not* declared: a
 * declaration is a hard dependency, and this bundle has to keep registering the
 * native card in a host page that provides neither. They are *waited for*
 * instead — `ctx.inject` runs a body on a context that owns the service — and
 * never read off this context, where a property read of an undeclared service
 * throws instead of answering `undefined`.
 */
export const inject = ["slots", "configForms"] as const;

/**
 * The Remote gateway service, and the namespace a mount adds to it.
 *
 * A mounted namespace is a service of its own rather than a field of the
 * gateway, so both names are read the same way: on a context that declared
 * them. Read from anywhere else — `ctx.remote`, or the namespace off a scope
 * that injected something else — Cordis throws
 * `cannot get property "<name>" without inject`. In the browser that becomes
 * `failed to apply loader entry (@yadsh/dsh-openviking-memory)` and the whole
 * plugin tree goes down with the entry, which is how the account-scoped page
 * once refused to compose in a deployed client.
 */
const REMOTE_GATEWAY = "remote";
const REMOTE_NAMESPACE = "remote.openvikingMemory";

/**
 * The seat this card takes on the host Plugins page: the `plugins.row.config`
 * key is the bundle's package name joined to the row id its `cordis.patch.yml`
 * declares, and that row id is the same `dsh-openviking-memory` the Host resolves
 * this plugin's volatile Config under, so the namespace a live stand already wrote
 * is read back unchanged.
 */
const ROW_CONFIG_KEY = `@yadsh/dsh-openviking-memory#${OPENVIKING_MEMORY_SETTINGS_NAMESPACE}`;

/** The QA service the account-scoped page mounts into, when it is there. */
const QA_SERVICES = ["qaUserSettingsSections"] as const;

/** Remote namespaces and QA services, as this bundle reads them. */
interface ClientFace {
  readonly remote: {
    $mount(
      contribution: TypertRemoteContribution,
    ): Promise<() => Promise<void>>;
    readonly openvikingMemory: MemoryOverviewRemote;
  };
  readonly qaUserSettingsSections: QaUserSettingsSections;
  effect(execute: () => () => void, name?: string): () => void;
}

/** Register the configuration page and the account-scoped Remote page. */
export function apply(ctx: Context): () => void {
  const form = ctx.configForms.get<Config>(
    OPENVIKING_MEMORY_SETTINGS_NAMESPACE,
  );

  // The Plugins page hands the row's configuration section an empty column, so the
  // card keeps its own shell (the AGENTS.md contract) and the stylesheet that
  // styles it.
  const removeStyles = injectCardStyles("@yadsh/dsh-openviking-memory", styles);
  const removeCard = ctx.slots.inject("plugins.row.config", () =>
    ctx.slots.register(
      {
        name: "plugins.row.config",
        key: ROW_CONFIG_KEY,
        // The seat hands the page's own `ConfigPageForm` — `{ state, mutate }`
        // only — so the card edits the full form this entry resolves, under a name
        // the owner prop cannot overwrite.
        inject: () => ({ settingsForm: form }),
      },
      OpenVikingMemoryCardEntry,
    ),
  );

  // The remote artifact registers the `openvikingMemory` namespace on the
  // gateway; the QA page is the only caller, so a deployment without a gateway
  // pays nothing beyond the mount itself — and keeps its native card.
  const stopRemote = registerAccountScope(ctx);

  return () => {
    stopRemote();
    removeCard();
    removeStyles();
  };
}

/**
 * Mount the Remote contribution and register the account-scoped page.
 *
 * Both halves of the Remote contract are reached by *declaring* what they read.
 * The gateway is waited for with `ctx.inject`, which is what keeps a page
 * without one working at all (and a gateway that arrives after this entry still
 * gets its page). The callback then runs on a context that owns `remote`, so
 * `$mount` is a legal read, and the namespace the mount installs is read on a
 * second scope that declared it.
 */
function registerAccountScope(ctx: Context): () => void {
  const waiting = ctx.inject([REMOTE_GATEWAY], (gatewayCtx) => {
    const gateway = (gatewayCtx as unknown as ClientFace).remote;
    if (gateway === undefined || typeof gateway.$mount !== "function") return;

    let stopped = false;
    let unmount: (() => Promise<void>) | undefined;
    const stopMount = (): void => {
      stopped = true;
      const dispose = unmount;
      unmount = undefined;
      if (dispose !== undefined) void dispose().catch(() => undefined);
    };

    void gateway
      .$mount(openvikingMemoryRemote)
      .then((disposeMount) => {
        if (stopped) {
          void disposeMount().catch(() => undefined);
          return;
        }
        unmount = disposeMount;
        try {
          gatewayCtx.inject([REMOTE_NAMESPACE, ...QA_SERVICES], (scopedCtx) => {
            const scoped = scopedCtx as unknown as ClientFace;
            const removeStyles = scoped.effect(() => {
              const tag = document.createElement("style");
              tag.dataset.dshOpenvikingMemory = "qa-settings";
              tag.textContent = qaSettingsStyles;
              document.head.append(tag);
              return () => tag.remove();
            }, "dsh-openviking-memory: qa settings styles");
            const removeSection = scoped.qaUserSettingsSections.register({
              id: QA_MEMORY_SECTION_ID,
              title: QA_MEMORY_SECTION_TITLE,
              order: 45,
              component: createMemoryOverviewSection(
                scoped.remote.openvikingMemory,
              ),
            });
            return () => {
              removeSection();
              removeStyles();
            };
          });
        } catch {
          // The entry was disposed while the mount was still in flight: give
          // the contribution back instead of leaving it mounted with no page.
          stopMount();
        }
      })
      .catch(() => undefined);

    // This disposer belongs to the gateway injection instance. Cordis invokes
    // it both on normal plugin cleanup and when that gateway disappears.
    return stopMount;
  });

  return () => {
    // The waiting fiber owns the namespace scope, so disposing it takes the
    // page and its stylesheet with it.
    void waiting.dispose();
  };
}
