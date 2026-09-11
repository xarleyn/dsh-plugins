
// dsh-doc-impact browser client bootstrap. tsdown wraps this module. tsdown wraps this module in the
// classic factory served by the DSH web ModuleLoader at
// /plugins/@yadsh/dsh-doc-impact/client.js.
//
// Registers the plugin's card into the shared "Plugins → Plugin Configuration"
// section: the card claims the `doc-impact` settings namespace via the
// `settings.plugin.item` keyed slot and stages edits through the client
// settings scope, exactly like the first-party plugin cards.
//
// UX contract (mirrors @deepseek-ai/dsh-client-ui-settings-plugins):
//   - one collapsible card; the header shows an "unsaved" badge while drafts
//     exist;
//   - every field shows whether saving would leave a user-layer override and,
//     when one stands, a reset that stages a clear back to the composition
//     layer;
//   - Save stays disabled until there is something to write (and while a draft
//     is invalid or a save is in flight); Discard drops staged drafts;
//   - nothing writes before Save.
//
// Pure browser code: no DSH host imports; React stays external and is resolved
// by the ModuleLoader. The slots / settingsScope / locale services are declared
// in `inject` (the 0.1.5 client runtime exposes only injected services, so a
// missing declaration makes `apply` see them as absent and silently skip the
// card); the method guards and fallback translations below keep headless or
// older profiles safe.


import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";
import { ConfigCard } from "./card.js";
import { DICT, fallbackT } from "./dictionary.js";
import { SettingsForm } from "./settings-form.js";

const SETTINGS_NS = "doc-impact";
const LOCALE_NS = "dsh-doc-impact";

export const name = "doc-impact";
export const inject = ["slots", "settingsScope", "locale"];

export function apply(ctx: any): void {
  let _t = fallbackT;
  const locale = ctx.locale;
  if (locale && typeof locale.register === "function" && typeof locale.bind === "function") {
    locale.register(LOCALE_NS, DICT);
    _t = locale.bind(LOCALE_NS);
  }

  const settingsScope = ctx.settingsScope;
  if (!settingsScope || typeof settingsScope.bind !== "function") return;
  const scope = settingsScope.bind({ namespace: SETTINGS_NS });
  const form = new SettingsForm(scope);

  registerSettingsCard(ctx, {
    key: SETTINGS_NS,
    locale: LOCALE_NS,
    component: ConfigCard,
    inject: function () {
      return form.inject();
    }
  });
}
