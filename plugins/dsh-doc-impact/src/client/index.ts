// dsh-doc-impact browser client bootstrap. tsdown wraps this module in the
// classic factory served by the DSH web ModuleLoader at
// /plugins/@yadsh/dsh-doc-impact/client.js.
//
// The card is the configuration entry of this bundle's own row on the Host's
// Plugins page: the keyed seat `plugins.row.config`, whose key joins the package
// name to the row id this entry's `cordis.patch.yml` declares. That row id is also
// the namespace the Host files this plugin's volatile Config under
// (`dsh-doc-impact`), so the half of the key and the namespace the form reads are
// one string, and a value an operator saved while the card sat on the old tab is
// read back from here unchanged — only where the card renders moved. The page
// titles the row itself and asks this one seat for two views, the heading line and
// the form (`docs/DSH-0.1.7-MIGRATION.md` §4.2).
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
// arrives as the translate seat the page synthesizes for the locale namespace this
// entry declares, which is why the dictionary below is registered before any seat is.

import type { ConfigForms } from "@deepseek-ai/dsh-client-ui-settings/client";
import { createElement } from "react";
import { CardSummary, ConfigCard, type ConfigCardProps } from "./card.js";
import { DICT } from "./dictionary.js";
import {
  SettingsForm,
  type CardFace,
  type SettingsDocument,
} from "./settings-form.js";

/** The profile entry id of `cordis.patch.yml`, which on this host *is* the namespace. */
const SETTINGS_NS = "dsh-doc-impact";
const LOCALE_NS = "dsh-doc-impact";
/**
 * The seat's key: this package's name joined to the row id the patch declares,
 * which is the namespace above. The page shows the row's configure control only
 * for a key its inventory carries, so `tests/client-bundle.test.ts` derives both
 * halves from `cordis.patch.yml` rather than repeating this line.
 */
const ROW_CONFIG_KEY = `@yadsh/dsh-doc-impact#${SETTINGS_NS}`;

/** The locale service, which an older or headless profile may keep to itself. */
interface LocaleService {
  register?(
    namespace: string,
    dictionary: Record<string, Record<string, string>>,
  ): void;
}

/**
 * The settings service the card reads its namespace through: the Host's own
 * `ConfigForms`, narrowed to the two members this entry calls, so a signature
 * change on the provider stops compiling here instead of being mirrored by hand.
 * `get` answers a controller for any name, served or not — "this profile does not
 * carry the namespace" is not in its reply, the transient lives in the snapshot
 * status. The instrument that says whether the namespace is served is
 * `whileServed`, and the card claims its seat inside it.
 */
type ConfigFormsService = Pick<ConfigForms, "get" | "whileServed">;

/** The seat the card claims: the configuration entry of this bundle's own row. */
interface RowSeat {
  name: string;
  key: string;
  locale: string;
  inject: () => CardFace;
}

/**
 * What the seat renders its entry with: the injected face, the page's translate
 * seat, and the two owner props the page spreads over them. `view` picks the view;
 * `form` is the page's own narrowed `{ state, mutate }`, which this card ignores
 * because it resolves the full `ConfigForm` through `ctx.configForms` — and it is
 * the reason the face must not carry a member named `form`.
 */
interface RowEntryProps extends ConfigCardProps {
  readonly view: "page" | "summary";
  readonly form?: unknown;
}

/**
 * The entry the seat registers. The page asks this one seat for two views: the
 * configuration section as `{ view: 'page', form }`, and the row's heading line as
 * `{ view: 'summary' }` whenever the patch declares no description of its own —
 * and `cordis.patch.yml` declares none, so that view is what an operator reads
 * first. Picking the component here, where the seat is registered, rather than
 * returning early inside `ConfigCard` is what keeps each view its own hook order:
 * the card reads the settings state, the one-liner reads none and mounts no shell,
 * so a line of heading text never gets a second live copy of the form in it.
 */
function RowConfigEntry(props: RowEntryProps) {
  if (props.view === "summary") {
    return createElement(CardSummary, props);
  }
  return createElement(ConfigCard, props);
}

/** The slot service that turns the seat and the component into a page. */
interface SlotsService {
  inject(slot: string, factory: () => () => void): () => void;
  register(
    seat: RowSeat,
    component: (props: RowEntryProps) => unknown,
  ): () => void;
}

/**
 * The services `inject` names. The client runtime exposes each declared service
 * as a context property, so an absent half reads as missing here rather than
 * crashing inside `apply`.
 */
export interface DocImpactClientContext {
  slots: SlotsService;
  locale?: LocaleService;
  configForms?: ConfigFormsService;
}

export const name = "doc-impact";
export const inject = ["slots", "configForms", "locale"];

export function apply(ctx: DocImpactClientContext): () => void {
  const locale = ctx.locale;
  if (locale && typeof locale.register === "function") {
    locale.register(LOCALE_NS, DICT);
  }

  const configForms = ctx.configForms;
  if (
    !configForms ||
    typeof configForms.get !== "function" ||
    typeof configForms.whileServed !== "function"
  )
    return function () {};
  const form = new SettingsForm(configForms.get<SettingsDocument>(SETTINGS_NS));

  // `whileServed` wraps the injection rather than the card body: it is the slot
  // injection that gives the row its configure control, so a namespace this
  // profile does not serve would otherwise leave a control opening a section with
  // nothing in it.
  //
  // The Host documents the reply as a disposer the caller owns — it ends the
  // watch and drops whatever registration is live. A client entry owes the
  // rollback of everything `apply` did (docs/PLUGIN_GUIDELINES.md §3.3.5), so the
  // two are kept and handed back here rather than thrown away as soon as they
  // were answered. Whether this host ever calls it is not observed from here —
  // what is observed is that keeping nothing left the choice to the Host alone.
  const endWatch = configForms.whileServed([SETTINGS_NS], function () {
    return ctx.slots.inject("plugins.row.config", function () {
      return ctx.slots.register(
        {
          name: "plugins.row.config",
          key: ROW_CONFIG_KEY,
          locale: LOCALE_NS,
          inject: function () {
            return form.inject();
          },
        },
        RowConfigEntry,
      );
    });
  });

  return function () {
    endWatch();
    form.dispose();
  };
}
