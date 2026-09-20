/**
 * Host-side settings section for the plugin (result-shaping SPEC §33-§34).
 *
 * The section owns the `jev-compaction` namespace; the browser card in
 * `src/client/` joins it through `settings.plugin.item` keyed by the same
 * string. The composition entry stays the base layer — a detached settings
 * provider falls back to it — and every attach, detach or committed change
 * re-resolves the runtime configuration and re-applies it.
 *
 * The section is registered on the Context this plugin was mounted on, so a
 * settings namespace without a live plugin (or vice versa) cannot happen.
 */

import type { Context } from "@deepseek-ai/cordis";

import type { JevCompactionConfig } from "../config.js";
import { JEV_COMPACTION_SETTINGS_NAMESPACE } from "../shared/settings.js";

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
      validate?(value: unknown): void;
    },
  ): void;
}

/** Structural view of the injecting context. */
export interface SettingsInjectedContext {
  settings?: SettingsInstallFace;
}

/** The host plugin face the installer needs. */
export interface SettingsInstallTarget {
  /** Context the plugin was mounted on; the section is registered on it. */
  readonly owner: Context;
  /** The composition entry: the base layer under every user override. */
  readonly entryConfig: JevCompactionConfig;
  /** Schema resolved by the settings service for this namespace. */
  readonly schema: unknown;
  /** Adopt the settings-driven source (or the entry when it detaches). */
  readonly setSource: (current: () => JevCompactionConfig) => void;
  /** Re-resolve and re-apply after an attach, detach or committed change. */
  readonly onChange: () => void;
  /** Reject values the schema cannot express before they are persisted. */
  readonly validate?: (value: JevCompactionConfig) => void;
}

/**
 * Install the plugin's settings section. Safe when the host exposes no
 * settings service (older profiles, headless probes): the plugin keeps
 * running on its composition config.
 */
export function installJevCompactionSettings(
  target: SettingsInstallTarget,
): void {
  target.owner.inject(["settings"], (injected) => {
    const settings = (injected as SettingsInjectedContext).settings;
    if (settings === undefined) return;
    settings.installSection(
      target.owner,
      JEV_COMPACTION_SETTINGS_NAMESPACE,
      target.schema,
      target.entryConfig,
      {
        setSource: (current) => {
          target.setSource(current as () => JevCompactionConfig);
        },
        onChange: () => {
          target.onChange();
        },
        ...(target.validate === undefined
          ? {}
          : {
              validate: (value: unknown) =>
                target.validate?.(value as JevCompactionConfig),
            }),
      },
    );
  });
}
