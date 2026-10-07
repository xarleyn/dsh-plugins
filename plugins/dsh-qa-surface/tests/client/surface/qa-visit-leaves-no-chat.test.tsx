// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  type RenderResult,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../src/resolve-config.js";
import type { ResolvedQaSurfaceConfig } from "../../../src/types.js";
import { QaAuditController } from "../../../src/client/audit/controller.js";
import { QaRouteController } from "../../../src/client/QaRouteController.js";
import {
  QaSurface,
  type QaSurfaceProps,
} from "../../../src/client/QaSurface.js";
import { QA_WELCOME_NOTICE_VERSION } from "../../../src/client/components/QaWelcomeNotice.js";
import { QaSurfacePanelRegistry } from "../../../src/client/panels/registry.js";
import { qaStorageNamespace } from "../../../src/shared/session-key.js";
import type { QaAccessApi } from "../../../src/client/types.js";
import {
  harness,
  type QaSessionTestWorld,
} from "../../helpers/session-fakes.js";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

let route: QaRouteController | undefined;
let view: RenderResult | undefined;

afterEach(() => {
  route?.dispose();
  route = undefined;
  view?.unmount();
  view = undefined;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

/**
 * The access answer, held by identity: a remote decode hands out a fresh object
 * per call, and that used to rebuild the session controller under the composer.
 */
function accessApi() {
  const value = {
    ok: true as const,
    value: {
      subroles: [],
      defaultSubrole: "general",
      policy: "selectable" as const,
    },
  };
  return {
    current: vi.fn(async () => value),
    session: vi.fn(async () => ({ ok: false as const, error: null })),
  } as unknown as QaAccessApi;
}

/** Mount the surface over one world, as a visitor who arrives with no chat. */
function mount(world: QaSessionTestWorld): ResolvedQaSurfaceConfig {
  window.history.replaceState(null, "", "/qa");
  const config = resolveConfig({
    ui: { showReset: true, showSessionList: true },
    lockdown: { allowSessionReset: true },
  });
  window.localStorage.setItem(
    `${qaStorageNamespace(config)}:welcome-notice`,
    QA_WELCOME_NOTICE_VERSION,
  );
  route = new QaRouteController();
  route.configure(config, true);
  const access = accessApi();
  const configSnapshot = { status: "ready" as const, config, error: null };
  view = render(
    <QaSurface
      {...({
        route,
        config: {
          subscribe: () => () => undefined,
          getSnapshot: () => configSnapshot,
        },
        accessApi: access,
        sessions: world.sessions,
        api: world.api,
        conversation: world.conversation,
        connection: world.connection,
        secureSession: world.secureSession,
        createSession: world.createSession,
        sourceApi: {
          sources: vi.fn(async () => ({ ok: true as const, value: [] })),
        },
        panels: new QaSurfacePanelRegistry(),
        audit: new QaAuditController(),
        settingsSections: {
          subscribe: () => () => undefined,
          getSnapshot: () => ({ sections: [], revision: 0 }),
          register: () => () => undefined,
        },
        renderSlot: () => null,
      } as unknown as QaSurfaceProps)}
    />,
  );
  return config;
}

const historyRows = (): number =>
  document.querySelectorAll("[data-testid='qa-surface-sidebar-item']").length;

describe("a visit to the QA surface", () => {
  it("leaves no chat in the history over three visits", async () => {
    const world = harness();
    for (let visit = 0; visit < 3; visit += 1) {
      mount(world);
      await screen.findByRole("combobox");
      expect(historyRows()).toBe(0);
      view?.unmount();
      view = undefined;
    }
    // Not a Host session, not a row, not a line in this browser's index.
    expect(world.createSession).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem("dsh-qa-surface.session:v1:/qa:chats") ??
        "[]",
    ).toBe("[]");
  });

  it("leaves exactly one chat once the visitor sends a question", async () => {
    const world = harness();
    mount(world);
    const field = await screen.findByRole("combobox");
    fireEvent.change(field, { target: { value: "Первый вопрос" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    // The chat lands in the history with the session its first question
    // materialized, and stays a single row.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(historyRows()).toBe(1);
    expect(screen.getByTestId("qa-surface-sidebar-item").textContent).toContain(
      "Новый чат",
    );
    expect(world.createSession).toHaveBeenCalledOnce();
  });
});
