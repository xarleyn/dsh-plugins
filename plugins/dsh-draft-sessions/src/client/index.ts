import type { Context } from "@deepseek-ai/cordis";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { IWorkspaces } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { IConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/remote-events";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import draftSessionsRemote from "../remote.js";
import { DraftComposerBridge } from "./composer.js";
import { DraftSessionLifecycle } from "./lifecycle.js";
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
    const sidebar = new DraftSidebarSource(remoteCtx, drafts);
    const lifecycle = new DraftSessionLifecycle(remoteCtx, {
      drafts,
      sessions: remoteCtx.sessions,
      status: (listener) =>
        remoteCtx.remote.$on("api-session/status", listener),
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
