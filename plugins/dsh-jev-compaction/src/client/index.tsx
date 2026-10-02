/**
 * Browser entry of the Jev Compaction settings card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * resolves the Host form for the plugin's own configuration section and mounts
 * the card as the configuration of this bundle's row on the Plugins page.
 * Everything the card shows comes from that form, so the plugin needs no Remote
 * namespace — and no API key ever crosses to the browser: the card edits the
 * *name* of the environment variable holding the key and only displays whether
 * the Host can resolve it.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";

import type { JevCompactionConfig } from "../config/index.js";
import { JEV_COMPACTION_SETTINGS_NAMESPACE } from "../shared/settings.js";
import {
  JEV_COMPACTION_ROW_SUMMARY,
  JevCompactionCard,
  type JevCompactionCardFace,
} from "./card.js";
import { styles } from "./styles.js";

/** Package name: the style-tag key and the card's own plugin identity. */
export const CLIENT_PLUGIN_NAME = "@yadsh/dsh-jev-compaction";

/**
 * The seat key: the package name joined to the row id as `cordis.patch.yml`
 * declares it. That row id is also the namespace the Host resolves this plugin's
 * volatile Config under, so the move changes where the card renders and nothing
 * about where its values live — one an older build saved is read back by this one.
 */
const ROW_CONFIG_KEY = `@yadsh/dsh-jev-compaction#${JEV_COMPACTION_SETTINGS_NAMESPACE}`;

/**
 * Client services this module reads. The client runtime resolves only
 * declared dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest.
 */
export const inject = ["slots", "configForms"];

function noop(): void {}

/** Structural view of the client context this entry needs. */
interface ClientFace {
  readonly slots: {
    inject(slotName: string, factory: () => unknown): () => void;
    register(options: unknown, component: unknown): () => void;
  };
  readonly configForms?: {
    get<T>(entryId: string): T;
  };
}

/**
 * What the entry consumes. The seat's own `form` is deliberately not declared:
 * it is the page's `ConfigPageForm` — `{ state, mutate }`, with no subscription
 * and no single-field read — and this card cannot be built from it, so the entry
 * resolves the full `ConfigForm` below. Declaring a prop and ignoring it would
 * read as a card that binds to the page's values but does not.
 */
type EntryProps = Omit<PropsRuntime<"plugins.row.config">, "form"> &
  InjectFace<JevCompactionCardFace>;

/**
 * The entry the Plugins page renders for this bundle's row: the page draws the
 * row's own card — surface, title, row id, module name, description line — and
 * mounts this registrant's body inside it, so the bundle contributes the body
 * and nothing around it (AGENTS.md).
 *
 * The page asks the one entry for two views. `page` is the body mounted above.
 * `summary` is the row's one-liner, which the page asks the entry for only
 * when the row carries no display description of its own (the seat contract in
 * `@deepseek-ai/dsh-client-ui-plugin-manager`; the row's description is Host
 * inventory data, so nothing in this bundle decides whether the fallback fires —
 * the entry answers it because the contract names it). The view lands inside the
 * page's own text, so it returns the sentence and never a second body.
 */
function JevCompactionEntry(props: EntryProps) {
  if (props.view === "summary") return JEV_COMPACTION_ROW_SUMMARY;
  return <JevCompactionCard settingsForm={props.settingsForm} />;
}

/** Resolve the settings form and register the card as the row's configuration. */
export function apply(ctx: Context): () => void {
  const face = ctx as unknown as Partial<ClientFace>;
  const slots = face.slots;
  // Headless probes and profiles without the settings client have no form to
  // bind; rendering no card beats crashing the page during module load
  // (AGENTS.md: no namespace, no card).
  if (
    face.configForms === undefined ||
    typeof face.configForms.get !== "function" ||
    slots === undefined
  ) {
    return noop;
  }

  // The row seat hands the page's own `ConfigPageForm`, which is `{ state,
  // mutate }` only — it cannot be subscribed to and carries no single-field
  // write — so the entry resolves the full form itself. The join key into the
  // Host settings document (`../shared/settings.ts`) is the row id.
  const form = face.configForms.get<JevCompactionConfig>(
    JEV_COMPACTION_SETTINGS_NAMESPACE,
  );
  const removeStyles = injectCardStyles(CLIENT_PLUGIN_NAME, styles);
  // The seat is named as a literal in the call rather than through a constant:
  // the card contract reads the surface this bundle registers on off the built
  // bundle, and the registration is the statement it reads.
  const disposeSlot = slots.inject("plugins.row.config", () =>
    slots.register(
      {
        name: "plugins.row.config",
        key: ROW_CONFIG_KEY,
        inject: () => ({ settingsForm: form }),
      },
      JevCompactionEntry,
    ),
  );

  return () => {
    disposeSlot();
    removeStyles();
  };
}
