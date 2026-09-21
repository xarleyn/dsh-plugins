/**
 * Host-side settings section for this plugin.
 *
 * A card rendered from the settings directory exists only for a namespace the
 * *live* plugin registered there: the browser asks the Host which namespaces it
 * serves, and mounts a `settings.plugin.item` entry per name. Declaring
 * `static Config` is not that registration — without this call the card's
 * component ships, loads and never appears anywhere.
 *
 * The section also makes the namespace a live configuration source: the service
 * hands over a reader over the merged layers (composition entry + user
 * overrides) and calls back on every committed change, so an edited switch
 * reaches the running plugin instead of waiting for a restart.
 *
 * The host face is structural on purpose, like the rest of this plugin's seams:
 * a profile without a settings provider keeps running on its composition entry.
 */

import type { Context } from "@deepseek-ai/cordis";

import type { Config } from "./config.js";
import { OPENVIKING_MEMORY_SETTINGS_NAMESPACE } from "./shared/settings.js";

/** Structural view of the host settings service (registration seam). */
export interface SettingsInstallFace {
  installSection(
    owner: Context,
    namespace: string,
    schema: unknown,
    entry: unknown,
    hooks: {
      setSource(current: () => unknown): void;
      onChange(): void;
    },
  ): void;
}

/** Structural view of the injecting context. */
export interface SettingsInjectedContext {
  settings?: SettingsInstallFace;
}

/** What the installer needs from the plugin. */
export interface SettingsInstallTarget {
  /** Context the plugin was mounted on; the section is registered on it. */
  readonly owner: Context;
  /** The composition entry: the base layer under every user override. */
  readonly entryConfig: Config;
  /** Schema resolved by the settings service for this namespace. */
  readonly schema: unknown;
  /** Adopt the live reader, or fall back to the entry when it detaches. */
  readonly setSource: (current: () => Config) => void;
  /** Re-resolve and re-apply after an attach, detach or committed change. */
  readonly onChange: () => void;
}

/**
 * Register the plugin's settings namespace. Safe when the host exposes no
 * settings service (older profiles, headless probes).
 */
export function installOpenVikingMemorySettings(
  target: SettingsInstallTarget,
): void {
  target.owner.inject(["settings"], (injected) => {
    const settings = (injected as unknown as SettingsInjectedContext).settings;
    if (settings === undefined) return;
    settings.installSection(
      target.owner,
      OPENVIKING_MEMORY_SETTINGS_NAMESPACE,
      target.schema,
      target.entryConfig,
      {
        setSource: (current) => {
          target.setSource(current as () => Config);
        },
        onChange: () => {
          target.onChange();
        },
      },
    );
  });
}
