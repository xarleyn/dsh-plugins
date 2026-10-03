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
// Both halves of the seat are spelled as literals in the call below, not reached
// through a constant: the card contract (`verify-plugin-card-contract.mjs`) reads
// which surface a bundle sits on off the built bundle, and a registration that names
// its seat in the call is the statement it can read. `tests/client-bundle.test.ts`
// is where the two halves stay joined to `cordis.patch.yml`.
//
// The row page draws the card surface, the heading and the expand control before it
// mounts this entry, so the bundle renders a body (AGENTS.md, "Two kinds of card").
//
// UX contract (the body's own, since the page supplies the chrome):
//   - the fields mount as soon as the row opens; an "unsaved" marker stands by the
//     Save and Discard controls while drafts exist;
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
// guards below keep headless or older profiles safe. The card's own text arrives
// as the `t` seat the Host's renderer synthesizes for the locale namespace this
// entry declares — it fails the slot assembly rather than rendering without it,
// which is why `card.ts` takes `t` as a definite prop and no fallback stands by.
// That is also why the dictionary below is registered before any seat is claimed.

import type { ConfigForms } from "@deepseek-ai/dsh-client-ui-settings/client";
import { RowConfigEntry, type RowEntryProps } from "./card.js";
import { DICT } from "./dictionary.js";
import {
  SettingsForm,
  type CardFace,
  type SettingsDocument,
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
}

/**
 * The settings service the card reads its namespace through: the Host's own
 * `ConfigForms`, narrowed to the one member this entry calls, so a signature
 * change on the provider stops compiling here instead of being mirrored by hand.
 * `get` answers a controller for any name, served or not — "this profile does not
 * carry the namespace" is not in its reply, the transient lives in the snapshot
 * status, and that is where the card reads it. `whileServed` is deliberately not
 * called: see the note above the seat.
 */
type ConfigFormsService = Pick<ConfigForms, "get">;

/** The seat the card claims: the configuration entry of this bundle's own row. */
interface RowSeat {
  name: string;
  key: string;
  /**
   * The locale namespace whose dictionary this entry translates with. The type is
   * the literal `LOCALE_NS` holds, and {@link RowEntryProps} composes its `t` seat
   * from that same namespace: the renderer synthesizes `t` exactly when the seat
   * declares one, so a seat naming a namespace the card was not typed against stops
   * compiling here instead of at render time.
   */
  locale: typeof LOCALE_NS;
  inject: () => CardFace;
}

/** The slot service that turns the seat and the component into a page. */
interface SlotsService {
  /**
   * Install the effect for each lifetime of one slot's declaration: the factory
   * runs at once when the slot already stands, and otherwise inside the declaring
   * `register()` once it is committed (`registry.d.ts`). So a host that never
   * declares this page leaves the factory uncalled — the card is absent rather than
   * throwing at `register`, which `register` would do only against a declared slot.
   * This wait is what makes a served-namespace watch redundant here: the page, not
   * the settings directory, is the thing this call already waits for.
   */
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
  if (!configForms || typeof configForms.get !== "function")
    return function () {};
  const form = new SettingsForm(configForms.get<SettingsDocument>(SETTINGS_NS));

  // The seat is claimed unconditionally, and not from inside
  // `configForms.whileServed([SETTINGS_NS], …)` even though that call exists and
  // reads like the purpose-built instrument. It is built for a page editing a
  // namespace *another* plugin owns: its callback runs once a namespace stands in
  // the `settings.describe` mirror, and that mirror answers `unavailable` as the
  // terminal state of a non-loopback page (`settings-mirror.d.ts`), where the
  // settings directory is deliberately not exposed. Gating on it would leave this
  // row without a configure control for exactly the browser AGENTS.md names for a
  // card seated on the Plugins panel — "keeps answering from a non-loopback
  // browser, where the settings directory is intentionally unavailable … disable
  // the write controls instead of hiding the card".
  //
  // Per-namespace reads do not go through that directory: `get` answers a form for
  // any entry id, and the form's own snapshot says whether a document stands under
  // it. So the unserved and the read-only cases are answered one level in, by the
  // body — a status line for a namespace nothing resolved, disabled controls for a
  // connection that keeps preferences process-local — which is what lets the row
  // keep its control without offering one that opens an empty section.
  const removeSeat = ctx.slots.inject("plugins.row.config", function () {
    // The key joins this package's name to the row id the patch declares, which is
    // the namespace the form above reads — the two halves are spelled out here so
    // the built bundle states its seat and its row without a constant to resolve,
    // and `tests/client-bundle.test.ts` holds both against `cordis.patch.yml`.
    return ctx.slots.register(
      {
        name: "plugins.row.config",
        key: "@yadsh/dsh-doc-impact#dsh-doc-impact",
        locale: LOCALE_NS,
        inject: function () {
          return form.inject();
        },
      },
      RowConfigEntry,
    );
  });

  // A client entry owes the rollback of everything `apply` did
  // (docs/PLUGIN_GUIDELINES.md §3.3.5), so both the registration and the form are
  // kept and handed back rather than dropped as soon as they were answered.
  return function () {
    removeSeat();
    form.dispose();
  };
}
