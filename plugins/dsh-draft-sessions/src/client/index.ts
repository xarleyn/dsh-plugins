import type { Context } from "@deepseek-ai/cordis";
import type {
  ConnectionHandle,
  IApiClient,
} from "@deepseek-ai/dsh-client-connection/client";
import type {
  ISessions,
  IWorkspaces,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { IConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import draftSessionsRemote from "../remote.js";
import { DraftComposerBridge } from "./composer.js";
import { DraftSessionLifecycle, envelopeSource } from "./lifecycle.js";
import { DraftSidebarSource } from "./sidebar.js";
import { DraftShortcutController } from "./shortcut.js";
import { activateWorkspaceContribution } from "./workspace-contribution.js";

export type * from "../shared/types.js";
export * from "./composer.js";
export * from "./lifecycle.js";
export * from "./sidebar.js";
export * from "./shortcut.js";
export * from "./workspace-contribution.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    connection: ConnectionHandle & { readonly api: IApiClient };
    sessions: ISessions;
    workspaces: IWorkspaces;
    conversation: IConversation;
    draftSessionLifecycle: DraftSessionLifecycle;
    draftComposerBridge: DraftComposerBridge;
    draftShortcutController: DraftShortcutController;
    draftSidebarSource: DraftSidebarSource;
  }
}

export const inject = [
  "remote",
  "connection",
  "sessions",
  "workspaces",
  "conversation",
  "slots",
  "locale",
];

/** Mount the strict Remote namespace and its blank-Session lifecycle bridge. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const dispose = await ctx.remote.$mount(draftSessionsRemote);
  await ctx.inject(["remote.draftSessions"], (remoteCtx) => {
    const drafts = remoteCtx.remote.draftSessions;
    const envelopes = envelopeSource(remoteCtx.connection.api);
    const sidebar = new DraftSidebarSource(remoteCtx, drafts);
    const lifecycle = new DraftSessionLifecycle(remoteCtx, {
      drafts,
      sessions: remoteCtx.connection.api.sessions,
      ...(envelopes === undefined ? {} : { envelopes }),
      sidebar,
    });
    const composer = new DraftComposerBridge(remoteCtx, {
      lifecycle,
      drafts,
      sessions: remoteCtx.sessions,
      conversation: remoteCtx.conversation,
      sidebar,
    });
    new DraftShortcutController(remoteCtx, {
      lifecycle,
      composer,
      sessions: remoteCtx.sessions,
      workspaces: remoteCtx.workspaces,
    });
    activateWorkspaceContribution(remoteCtx, sidebar);
  });
  return dispose;
}
