/**
 * The browser entry: one conversation view, registered unconditionally.
 *
 * The tab is always present (SPEC §37). A view that appears only once an audit
 * exists would make the strip's contents depend on data, so a reader could not
 * learn that audits exist by looking; an empty state teaches that instead.
 *
 * Everything the tab needs arrives through the `conversation.view` slot's own
 * props and inject face — no context capture, no assumed boot order — and the
 * registration rides the slot service's effect, so unloading the plugin
 * removes the tab.
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type { ConvViewProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import sessionAuditRemote from "@yadsh/dsh-session-audit/remote";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";
import type { ReactNode } from "react";
import { AuditPage } from "./AuditPage.js";
import {
  createAuditApi,
  type AuditApi,
  type SessionAuditRemote,
} from "./api.js";
import { SESSION_AUDIT_STYLES, SESSION_AUDIT_STYLE_KEY } from "./styles.js";

export const inject = ["slots", "remote"];

/**
 * The mounted Remote namespace, as the client sees it.
 *
 * Typed here rather than read from the generated artifact: the artifact only
 * exists after a build, and a source tree that cannot typecheck before its
 * first `generate-typert` is a worse trade than one local interface.
 */
interface ClientRemote {
  readonly sessionAudit: SessionAuditRemote;
  $mount(contribution: unknown): Promise<() => Promise<void>>;
}

/** The slot id, and the tab's label. */
export const AUDIT_VIEW_ID = "audit";
export const AUDIT_VIEW_LABEL = "Audit";

/** What the view is handed when the slot builds it. */
export interface AuditViewInjected {
  readonly api: AuditApi;
  readonly sessionId: string;
}

/** The conversation view itself. Nothing below here knows it is in a page. */
export function AuditView(
  props: ConvViewProps & InjectFace<AuditViewInjected>,
): ReactNode {
  return <AuditPage sessionId={props.sessionId} api={props.api} />;
}

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const removeStyles = injectCardStyles(
    SESSION_AUDIT_STYLE_KEY,
    SESSION_AUDIT_STYLES,
  );
  const remote = ctx.remote as unknown as ClientRemote;

  let disposeRemote: (() => Promise<void>) | undefined;
  try {
    disposeRemote = await remote.$mount(sessionAuditRemote);
    await ctx.inject(["remote.sessionAudit"], (remoteCtx) => {
      const mounted = remoteCtx.remote as unknown as ClientRemote;
      const api = createAuditApi(mounted.sessionAudit);
      remoteCtx.slots.inject("conversation.view", () =>
        remoteCtx.slots.register(
          {
            name: "conversation.view",
            id: AUDIT_VIEW_ID,
            // After Chat (0) and Trajectory (10): the audit is a place a
            // reader goes once the work is done.
            order: 20,
            label: AUDIT_VIEW_LABEL,
            inject: (sessionId: string): AuditViewInjected => ({
              api,
              sessionId,
            }),
          },
          AuditView,
        ),
      );
    });
  } catch (error) {
    // A half-applied plugin is worse than one that did not load: undo the
    // mount and the stylesheet before surfacing the failure.
    removeStyles();
    await disposeRemote?.();
    throw error;
  }

  return async () => {
    removeStyles();
    await disposeRemote?.();
  };
}

export type { AuditApi, SessionAuditRemote, RemoteResult };
export { createAuditApi } from "./api.js";
export { AuditPage, type AuditPageProps } from "./AuditPage.js";
export { SESSION_AUDIT_STYLES, SESSION_AUDIT_STYLE_KEY } from "./styles.js";
