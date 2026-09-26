/**
 * Host-side settings surface for the plugin (result-shaping SPEC §33-§34).
 *
 * On 0.1.7 a plugin's configuration *is* its settings namespace: the fields the
 * browser card edits carry `.volatile()` (`../config.ts`), the Host serves them
 * live under this entry's id, and the card writes them through
 * `ctx.configForms`. There is nothing to install any more — the section, its
 * schema and its hooks were all the plugin's own copy of state the Host now
 * owns. What is left is the presentation choice: this plugin ships its own
 * card, so it declines the automatically generated page.
 *
 * Two Host rules shape the call below: `settings` is an *optional* service (so
 * the inject stays soft and a headless probe simply renders nothing), and
 * `configure()` is single-shot per fiber (so the call belongs in an effect
 * bound to the injected context, which is what survives a re-provide).
 */

import type { Context } from "@deepseek-ai/cordis";

/** Structural view of the host settings service (presentation seam). */
export interface SettingsPresentationFace {
  configure(presentation: { auto?: boolean }, owner?: unknown): void;
}

/** Structural view of the injecting context. */
export interface SettingsInjectedContext {
  settings?: SettingsPresentationFace;
  effect(callback: () => void): void;
}

/**
 * Decline the Host-generated settings page for this entry's volatile fields.
 * Safe when the host exposes no settings service (older profiles, headless
 * probes): the plugin keeps running on its configuration either way.
 */
export function installJevCompactionSettings(owner: Context): void {
  owner.inject(["settings"], (injected) => {
    const child = injected as unknown as SettingsInjectedContext;
    child.effect(() => {
      child.settings?.configure({ auto: false }, owner.fiber);
    });
  });
}
