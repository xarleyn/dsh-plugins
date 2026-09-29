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

import { ConfigCard, type ConfigCardProps } from "./card.js";
import { DICT, fallbackT, type Translate } from "./dictionary.js";
import {
  SettingsForm,
  type CardFace,
  type NamespaceForm,
} from "./settings-form.js";

/** The profile entry id of `cordis.patch.yml`, which on this host *is* the namespace. */
const SETTINGS_NS = "dsh-doc-impact";
const LOCALE_NS = "dsh-doc-impact";

/** The locale service, which an older or headless profile may keep to itself. */
interface LocaleService {
  register?(
    namespace: string,
    dictionary: Record<string, Record<string, string>>,
  ): void;
  bind?(namespace: string): Translate;
}

/**
 * The settings service the card reads its namespace through. `get` answers a
 * controller for any name, served or not, so "this profile does not carry the
 * namespace" is not in its reply — the transient lives in the snapshot status
 * instead. The instrument that says whether the namespace is served is
 * `whileServed`, and the card claims its seat inside it.
 */
interface ConfigFormsService {
  get(namespace: string): NamespaceForm;
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void;
}

/** The seat the card claims on the Settings → Plugins page. */
interface TabSeat {
  name: string;
  id: string;
  order: number;
  label: () => string;
  locale: string;
  inject: () => CardFace;
}

/** The slot service that turns the seat and the component into a page. */
interface SlotsService {
  inject(slot: string, factory: () => () => void): () => void;
  register(
    seat: TabSeat,
    component: (props: ConfigCardProps) => unknown,
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

export function apply(ctx: DocImpactClientContext): void {
  let _t: Translate = fallbackT;
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
  if (
    !configForms ||
    typeof configForms.get !== "function" ||
    typeof configForms.whileServed !== "function"
  )
    return;
  const form = new SettingsForm(configForms.get(SETTINGS_NS));

  // `whileServed` wraps the injection rather than the card body: it is the slot
  // injection that draws the tab, so a namespace this profile does not serve
  // would otherwise leave an empty tab on the Plugins page.
  configForms.whileServed([SETTINGS_NS], function () {
    return ctx.slots.inject("settings.plugins.tab", function () {
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
  });
}
