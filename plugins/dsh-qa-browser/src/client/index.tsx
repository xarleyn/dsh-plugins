import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/remote-events";
import type {} from "@deepseek-ai/dsh-api-session-controller/types";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import {
  QA_SURFACE_PANEL_SLOT,
  type QaSurfacePanelOwnerProps,
} from "@yadsh/dsh-qa-surface/client/panels";

import qaBrowserRemote from "../remote.js";
import { BrowserPanel, type BrowserPanelRemote } from "./BrowserPanel.js";
import { BROWSER_PANEL_STYLES } from "./styles.js";

const PANEL_ID = "@yadsh/dsh-qa-browser";

export const inject = ["remote", "slots", "qaSurfacePanels"];

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const style = document.createElement("style");
  style.dataset.dshQaBrowser = "panel";
  style.textContent = BROWSER_PANEL_STYLES;
  document.head.append(style);

  const disposeRemote = await ctx.remote.$mount(qaBrowserRemote);
  let disposePanel: () => void = () => undefined;
  let disposeSlot: () => void = () => undefined;
  await ctx.inject(["remote.qaBrowser"], (remoteContext) => {
    const browserRemote = remoteContext.remote.qaBrowser as BrowserPanelRemote;
    disposePanel = ctx.qaSurfacePanels.register({
      id: PANEL_ID,
      kind: "browser",
      title: () => "Browser",
      description: () => "Страница, которой управляет агент",
      icon: "browser",
      order: 100,
      keepMounted: true,
    });
    disposeSlot = ctx.slots.register(
      { name: QA_SURFACE_PANEL_SLOT, key: PANEL_ID },
      (owner: QaSurfacePanelOwnerProps) => (
        <BrowserPanel {...owner} browserRemote={browserRemote} />
      ),
    );

    let timer: number | undefined;
    let probing = false;
    const stopProbe = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const probe = async (expectedSessionId: string) => {
      if (probing || ctx.qaSurfacePanels.getActiveKind() === "browser") return;
      const current = ctx.qaSurfacePanels.getContext();
      if (current.sessionId !== expectedSessionId) {
        stopProbe();
        return;
      }
      probing = true;
      try {
        const result = await browserRemote.panelState(
          current.qaToken,
          expectedSessionId,
        );
        if (
          result.ok &&
          result.value.autoRevealOnAgentActivity &&
          result.value.session !== null
        ) {
          ctx.qaSurfacePanels.open("browser", {
            reason: "activity",
            focus: result.value.focusOnAutoReveal,
          });
          stopProbe();
        }
      } finally {
        probing = false;
      }
    };
    const disposeStatus = remoteContext.remote.$on(
      "api-session/status",
      (sessionId, running) => {
        const current = ctx.qaSurfacePanels.getContext();
        if (current.sessionId !== String(sessionId)) return;
        stopProbe();
        void probe(String(sessionId));
        if (running) {
          timer = window.setInterval(
            () => void probe(String(sessionId)),
            750,
          );
        }
      },
    );
    ctx.effect(
      () => () => {
        stopProbe();
        disposeStatus();
      },
      "dsh-qa-browser: activity reveal",
    );
  });

  return async () => {
    disposeSlot();
    disposePanel();
    style.remove();
    await disposeRemote();
  };
}

export { BrowserPanel } from "./BrowserPanel.js";
export type { BrowserPanelProps, BrowserPanelRemote } from "./BrowserPanel.js";
