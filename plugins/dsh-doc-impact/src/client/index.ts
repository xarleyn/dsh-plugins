// dsh-doc-impact browser client bootstrap. tsdown wraps this module in the
// classic factory served by the DSH web ModuleLoader at
// /plugins/@yadsh/dsh-doc-impact/client.js.
//
// The card is a tab of the Settings → Plugins page: the surface the Host still
// serves for a plugin-owned configuration page, claimed under the namespace this
// entry's profile row publishes (`dsh-doc-impact`, the same string as the seat
// id, so the two halves join without either naming the other). The card keeps
// the shared shell — the Host draws no chrome here.
//
// UX contract (mirrors the first-party plugin cards):
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
// by the ModuleLoader. The slots / configForms / locale services are declared in
// `inject` (the client runtime exposes only injected services, so a missing
// declaration makes `apply` see them as absent and silently skip the card); the
// method guards and fallback translations below keep headless or older profiles
// safe.

import { ConfigCard } from "./card.js";
import { DICT, fallbackT } from "./dictionary.js";
import { SettingsForm } from "./settings-form.js";

/** The profile entry id of `cordis.patch.yml`, which on this host *is* the namespace. */
const SETTINGS_NS = "dsh-doc-impact";
const LOCALE_NS = "dsh-doc-impact";

export const name = "doc-impact";
export const inject = ["slots", "configForms", "locale"];

export function apply(ctx: any): void {
  let _t = fallbackT;
  const locale = ctx.locale;
  if (
    locale &&
    typeof locale.register === "function" &&
    typeof locale.bind === "function"
  ) {
    locale.register(LOCALE_NS, DICT);
    _t = locale.bind(LOCALE_NS);
  }

  const configForms = ctx.configForms;
  if (!configForms || typeof configForms.get !== "function") return;
  const form = new SettingsForm(configForms.get(SETTINGS_NS));

  ctx.slots.inject("settings.plugins.tab", function () {
    return ctx.slots.register(
      {
        name: "settings.plugins.tab",
        id: SETTINGS_NS,
        order: 30,
        label: function () {
          return _t("cardTitle");
        },
        locale: LOCALE_NS,
        inject: function () {
          return form.inject();
        },
      },
      ConfigCard,
    );
  });
}
