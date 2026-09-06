import type { Context } from "@deepseek-ai/cordis";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type { ISessions } from "@deepseek-ai/dsh-client-runtime/client";
import type { SettingsScopeBinder } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { QaConfigController } from "./QaConfigController.js";
import { QaRouteController } from "./QaRouteController.js";
import { QaSurface } from "./QaSurface.js";
import { QA_SURFACE_STYLES } from "./styles.js";
import type { QaSurfaceConfig } from "../types.js";

const SETTINGS_NAMESPACE = "qa-surface";

declare module "@deepseek-ai/cordis" {
  interface Context {
    connection: ConnectionHandle;
    sessions: ISessions;
    settingsScope: SettingsScopeBinder;
  }
}

export const inject = ["slots", "sessions", "connection", "settingsScope"];

/** Register the route-aware, full-frame QA entry in the additive overlay slot. */
export function apply(ctx: Context): void {
  const route = new QaRouteController();
  const config = new QaConfigController(
    ctx.settingsScope.bind<QaSurfaceConfig>({ namespace: SETTINGS_NAMESPACE }),
  );
  const syncRoute = () => {
    const snapshot = config.getSnapshot();
    route.configure(
      snapshot.config,
      snapshot.status === "ready" || snapshot.status === "unavailable",
    );
  };
  syncRoute();
  const unsubscribeConfig = config.subscribe(syncRoute);

  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.dshQaSurface = "styles";
    style.textContent = QA_SURFACE_STYLES;
    document.head.append(style);
    return () => style.remove();
  }, "dsh-qa-surface: styles");

  ctx.effect(
    () => () => {
      unsubscribeConfig();
      config.dispose();
      route.dispose();
    },
    "dsh-qa-surface: controllers",
  );

  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-qa-surface",
        order: -10_000,
        inject: () => ({
          route,
          config,
          sessions: ctx.sessions,
          api: ctx.connection.api.sessions,
          connection: ctx.connection.hostDescription,
        }),
      },
      QaSurface,
    ),
  );
}

export { QaConfigController } from "./QaConfigController.js";
export { QaRouteController, matchesQaRoute } from "./QaRouteController.js";
export { QaSessionController } from "./QaSessionController.js";
export { projectTranscript } from "./QaTranscriptAdapter.js";
