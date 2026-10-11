/**
 * Browser entry of the Jev Compaction settings card.
 *
 * The ModuleLoader registration (`window.__ModuleLoader__.load({ id, factory })`
 * with the full package name) is produced by the tsdown banner; this module
 * binds the plugin's settings namespace and registers the card in the shared
 * `settings.plugin.item` slot. Everything the card shows comes from the
 * settings scope, so the plugin needs no Remote namespace — and no API secret
 * ever crosses to the browser: the card edits the *name* of the environment
 * variable holding the key and only displays whether the Host can resolve it.
 *
 * The same bundle also registers the conversation contribution that draws one
 * card per recorded compaction run into the transcript (SPEC §28). That half
 * reads no settings and no Remote: it projects the plugin's own durable
 * session events, so it keeps working wherever the conversation does.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { registerSettingsCard } from "@yadsh/dsh-plugin-kit/client";

import { JEV_COMPACTION_SETTINGS_NAMESPACE } from "../shared/settings.js";
import { JevCompactionCard } from "./card.js";
import {
  JEV_COMPACTION_NODE_KIND,
  jevCompactionConversationDefinition,
} from "./conversation.js";
import { JevCompactionRunCard } from "./run-card.js";
import { styles } from "./styles.js";

/** Package name: the style-tag key and the card's own plugin identity. */
export const CLIENT_PLUGIN_NAME = "@yadsh/dsh-jev-compaction";

/**
 * Client services this module reads. The client runtime resolves only
 * declared dependencies, so they must be listed here as well as in the
 * `dsh.client.inject` manifest.
 */
export const inject = ["slots", "settingsScope", "uiConversation"];

function noop(): void {}

/** Structural view of the client context this entry needs. */
interface ClientFace {
  readonly slots: {
    inject(slotName: string, factory: () => unknown): () => void;
    register(options: unknown, component: unknown): () => void;
  };
  readonly settingsScope: {
    bind(spec: { namespace: string }): unknown;
  };
  readonly uiConversation?: {
    events: { register(definition: unknown): () => void };
  };
}

/** Bind the settings namespace and register the native settings card. */
export function apply(ctx: Context): () => void {
  const face = ctx as unknown as Partial<ClientFace>;
  // Headless probes and older profiles may lack the binder; rendering no card
  // beats crashing the page during module load (AGENTS.md: no namespace, no
  // card).
  if (
    face.settingsScope === undefined ||
    typeof face.settingsScope.bind !== "function" ||
    face.slots === undefined
  ) {
    return noop;
  }

  const scope = face.settingsScope.bind({
    namespace: JEV_COMPACTION_SETTINGS_NAMESPACE,
  });
  const slots = face.slots;

  const disposeCard = registerSettingsCard(face as never, {
    key: JEV_COMPACTION_SETTINGS_NAMESPACE,
    pluginName: CLIENT_PLUGIN_NAME,
    styles,
    component: JevCompactionCard,
    inject: () => ({ scope }),
  });

  // The conversation card is independent of the settings binder: a page that
  // serves no settings directory still shows what a compaction did. Register
  // the Definition first — a node with no renderer would fall back to the
  // host's raw-JSON row, which is exactly what this card exists to prevent.
  const disposers: Array<() => void> = [disposeCard];
  const conversation = face.uiConversation;
  if (conversation !== undefined) {
    disposers.push(
      conversation.events.register(jevCompactionConversationDefinition),
      slots.inject("conversation.chat.node", () =>
        slots.register(
          {
            name: "conversation.chat.node",
            key: JEV_COMPACTION_NODE_KIND,
          },
          JevCompactionRunCard,
        ),
      ),
    );
  }

  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
