import type { Context } from "@deepseek-ai/cordis";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import {
  QA_SURFACE_PANEL_SLOT,
  type QaSurfacePanelOwnerProps,
} from "@yadsh/dsh-qa-surface/client/panels";

const PANEL_ID = "@fixture/dsh-qa-panel-consumer";

function FixturePanel(props: PropsRuntime<typeof QA_SURFACE_PANEL_SLOT>) {
  const owner: QaSurfacePanelOwnerProps = props;
  void owner.sessionId;
  void owner.qaToken;
  return null;
}

export const inject = ["slots", "qaSurfacePanels"];

/** External-package compile fixture: it uses only the published panel API. */
export function apply(ctx: Context): void {
  ctx.effect(
    () =>
      ctx.qaSurfacePanels.register({
        id: PANEL_ID,
        kind: "browser",
        title: () => "Fixture Browser",
        icon: "browser",
        keepMounted: true,
      }),
    "fixture: qa panel metadata",
  );
  ctx.slots.inject(QA_SURFACE_PANEL_SLOT, () =>
    ctx.slots.register(
      {
        name: QA_SURFACE_PANEL_SLOT,
        key: PANEL_ID,
      },
      FixturePanel,
    ),
  );
  ctx.qaSurfacePanels.open("browser", {
    reason: "extension",
    focus: false,
    params: { url: "about:blank" },
  });
}
