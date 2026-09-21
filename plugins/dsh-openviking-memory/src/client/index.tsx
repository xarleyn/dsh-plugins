/**
 * Browser entry of the OpenViking Memory settings surfaces.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * binds the plugin's settings namespace, registers the native settings card,
 * and — where a QA surface is mounted — the account-scoped page that a browser
 * reaching the deployment over the network can actually open.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type { TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";
import type { QaUserSettingsSections } from "@yadsh/dsh-qa-surface/client/settings";
import openvikingMemoryRemote from "@yadsh/dsh-openviking-memory/remote";

import type { Config } from "../config.js";
import { OPENVIKING_MEMORY_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { OpenVikingMemoryCard } from "./card.js";
import {
  QA_MEMORY_SECTION_ID,
  QA_MEMORY_SECTION_TITLE,
  createMemorySettingsSection,
  qaSettingsStyles,
  type MemoryClientRemote,
} from "./qa-settings.js";
import { styles } from "./styles.js";

/**
 * Client services this module reads. The 0.1.5 client runtime resolves only
 * declared dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest.
 *
 * The Remote gateway and the QA services are deliberately *not* declared: a
 * declaration is a hard dependency, and this bundle has to keep registering the
 * native card in a host page that provides neither. Both are read leniently
 * below, and the QA page simply never appears where they are missing.
 */
export const inject = ["slots", "settingsScope"] as const;

/** The QA service the account-scoped page mounts into, when it is there. */
const QA_SERVICES = ["qaUserSettingsSections"] as const;

/** Remote namespaces and QA services, as this bundle reads them. */
interface ClientFace {
  readonly remote: {
    $mount(
      contribution: TypertRemoteContribution,
    ): Promise<() => Promise<void>>;
    readonly openvikingMemory: MemoryClientRemote;
  };
  readonly qaUserSettingsSections: QaUserSettingsSections;
  effect(execute: () => () => void, name?: string): () => void;
}

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

  const face = ctx as unknown as ClientFace;
  const scope = settingsScope.bind<Config>({
    namespace: OPENVIKING_MEMORY_SETTINGS_NAMESPACE,
  });

  const removeCard = registerSettingsCard(ctx, {
    key: OPENVIKING_MEMORY_SETTINGS_NAMESPACE,
    pluginName: "@yadsh/dsh-openviking-memory",
    styles,
    component: OpenVikingMemoryCard,
    inject: () => ({ scope }),
  });

  // The remote artifact registers the `openvikingMemory` namespace on the
  // gateway; the QA page is the only caller, so a deployment without a gateway
  // pays nothing beyond the mount itself — and keeps its native card.
  const remote = face.remote;
  let removeQa = noop;
  if (remote !== undefined && typeof remote.$mount === "function") {
    void remote
      .$mount(openvikingMemoryRemote)
      .then(() => {
        removeQa = registerQaSection(ctx);
      })
      .catch(() => undefined);
  }

  return () => {
    removeQa();
    removeCard();
  };
}

/**
 * Mount the account-scoped page once QA Surface is up. `ctx.inject` fires as
 * soon as the service exists, so the page appears even when this bundle loaded
 * before the QA overlay did.
 */
function registerQaSection(ctx: Context): () => void {
  let remove = noop;
  const fiber = ctx.inject([...QA_SERVICES], (injected) => {
    const scoped = injected as unknown as ClientFace;
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
      component: createMemorySettingsSection(scoped.remote.openvikingMemory),
    });
    remove = () => {
      removeSection();
      removeStyles();
    };
  });
  return () => {
    remove();
    void fiber;
  };
}
