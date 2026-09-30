// dsh-doc-impact browser client bootstrap. tsdown wraps this module in the
// classic factory served by the DSH web ModuleLoader at
// /plugins/@yadsh/dsh-doc-impact/client.js.
//
// The card is the configuration entry of this bundle's row on the Plugins page:
// the keyed seat `plugins.row.config`, whose key joins the package name to the row
// id `cordis.patch.yml` declares. That row id is also the namespace the Host files
// this plugin's live Config under (`dsh-doc-impact`), so the values a stand already
// wrote are read back by this card unchanged — only where it renders moved. The
// page draws the row's title, icon and crumb around the entry; the card keeps the
// shared shell inside it.
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
// method guards below keep headless or older profiles safe. The card's own text
// arrives as the page's translate seat for the locale namespace this entry
// declares, which is why the dictionary below is registered before any seat is.

import { ConfigCard } from "./card.js";
import { DICT } from "./dictionary.js";
import { SettingsForm } from "./settings-form.js";

/** The profile entry id of `cordis.patch.yml`, which on this host *is* the namespace. */
const SETTINGS_NS = "dsh-doc-impact";
const LOCALE_NS = "dsh-doc-impact";
/**
 * The seat the card takes: `plugins.row.config` is keyed by the bundle's package
 * name joined to the row id its patch declares, and that row id is the namespace
 * above. The seat carries no `label` — the page titles the row from the plugin's
 * own display name.
 */
const ROW_CONFIG_KEY = `@yadsh/dsh-doc-impact#${SETTINGS_NS}`;

export const name = "doc-impact";
export const inject = ["slots", "configForms", "locale"];

export function apply(ctx: any): void {
  const locale = ctx.locale;
  if (locale && typeof locale.register === "function") {
    locale.register(LOCALE_NS, DICT);
  }

  const configForms = ctx.configForms;
  if (!configForms || typeof configForms.get !== "function") return;
  const form = new SettingsForm(configForms.get(SETTINGS_NS));

  ctx.slots.inject("plugins.row.config", function () {
    return ctx.slots.register(
      {
        name: "plugins.row.config",
        key: ROW_CONFIG_KEY,
        locale: LOCALE_NS,
        inject: function () {
          return form.inject();
        },
      },
      ConfigCard,
    );
  });
}
