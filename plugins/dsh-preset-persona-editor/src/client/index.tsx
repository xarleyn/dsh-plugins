/**
 * Browser entry of the persona page.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * mounts the generated Remote contribution and registers the page into the
 * settings shell's section list, right after the deployment's own Agent
 * Presets page.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import personaRemote from "@yadsh/dsh-preset-persona-editor/remote";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";

import type {
  PersonaCatalog,
  PersonaDocument,
  PersonaDraft,
  PersonaWriteReceipt,
} from "../types.js";
import { PersonaPage, type PersonaPageInjected } from "./PersonaPage.js";
import { strings } from "./locale.js";
import { PersonaPageController, type PersonaFace } from "./store.js";
import { styles } from "./styles.js";

/** The style tag's key: the full package name, like the bundle registration. */
const PLUGIN_PACKAGE_NAME = "@yadsh/dsh-preset-persona-editor";

/** The mounted `presetPersonaEditor` namespace as the gateway exposes it. */
interface PresetPersonaRemote {
  list(): Promise<RemoteResult<PersonaCatalog>>;
  read(agentPreset: string): Promise<RemoteResult<PersonaDocument>>;
  save(
    agentPreset: string,
    persona: PersonaDraft,
    expectedRevision: string,
  ): Promise<RemoteResult<PersonaWriteReceipt>>;
  reset(
    agentPreset: string,
    expectedRevision: string,
  ): Promise<RemoteResult<PersonaWriteReceipt>>;
  copy(
    from: string,
    id: string,
    name: string,
  ): Promise<RemoteResult<PersonaDocument>>;
}

/** The client Remote face this module drives. */
interface ClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>;
  presetPersonaEditor: PresetPersonaRemote;
}

/**
 * Client services this module reads. The 0.1.5 client runtime resolves only
 * declared dependencies, so they are listed here as well as in the
 * `dsh.client.inject` manifest.
 */
export const inject = ["slots", "remote"];

/**
 * Mount the Remote contribution and register the persona page.
 * @param ctx - the browser plugin context.
 * @returns a disposer that unregisters the page, its styles, and the Remote.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as unknown as ClientRemote;
  const disposeRemote = await remote.$mount(personaRemote);
  const removeStyles = injectCardStyles(PLUGIN_PACKAGE_NAME, styles);
  try {
    // The namespace exists only on the context that injected it, and the
    // callback re-runs when the namespace is re-granted: returning the slot
    // registration's own disposer is what replaces the previous page rather
    // than stacking a second one.
    await ctx.inject(["remote.presetPersonaEditor"], (remoteCtx) => {
      const injected = remoteCtx.remote as unknown as ClientRemote;
      const face: PersonaFace = {
        list: () => injected.presetPersonaEditor.list(),
        read: (agentPreset) => injected.presetPersonaEditor.read(agentPreset),
        save: (agentPreset, persona, expectedRevision) =>
          injected.presetPersonaEditor.save(
            agentPreset,
            persona,
            expectedRevision,
          ),
        reset: (agentPreset, expectedRevision) =>
          injected.presetPersonaEditor.reset(agentPreset, expectedRevision),
        copy: (from, id, name) =>
          injected.presetPersonaEditor.copy(from, id, name),
      };
      const registered: PersonaPageInjected = {
        controller: new PersonaPageController(face),
      };
      return remoteCtx.slots.inject("settings.section", () =>
        remoteCtx.slots.register(
          {
            name: "settings.section",
            id: "preset-persona",
            // Ordered after the deployment's Agent Presets section (20): this
            // page edits one field of what that page composes.
            order: 21,
            label: strings.nav,
            inject: () => registered,
          },
          PersonaPage,
        ),
      );
    });
  } catch (cause) {
    removeStyles();
    await disposeRemote();
    throw cause;
  }
  return async () => {
    removeStyles();
    await disposeRemote();
  };
}
