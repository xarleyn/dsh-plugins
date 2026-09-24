// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QaAccountUserPublic } from "../../../src/types.js";
import { resolveConfig } from "../../../src/resolve-config.js";
import type {
  QaAccountsController,
  QaAccountsSnapshot,
} from "../../../src/client/QaAccountsController.js";
import { QaAuditController } from "../../../src/client/audit/controller.js";
import { QaRouteController } from "../../../src/client/QaRouteController.js";
import {
  QaSurface,
  type QaSurfaceProps,
} from "../../../src/client/QaSurface.js";
import { QA_WELCOME_NOTICE_VERSION } from "../../../src/client/components/QaWelcomeNotice.js";
import { QaSurfacePanelRegistry } from "../../../src/client/panels/registry.js";
import type { QaAccessApi } from "../../../src/client/types.js";
import { qaStorageNamespace } from "../../../src/shared/session-key.js";
import { harness } from "../../helpers/session-fakes.js";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const SAVED_SESSION = "session-saved";

function accountUser(): QaAccountUserPublic {
  return {
    id: "user-1",
    email: "user@example.com",
    displayName: "user",
    role: "user",
    createdAt: "2026-09-23T00:00:00.000Z",
    lastLoginAt: null,
    disabled: false,
    profile: {
      fullName: "Демо-пользователь",
      identities: {},
      instructions: "",
      updatedAt: null,
    },
    starters: { items: [], hideDefaults: false },
  };
}

function liveAccounts() {
  const listeners = new Set<() => void>();
  let snapshot: QaAccountsSnapshot = {
    stage: "authed",
    user: accountUser(),
    ownedIds: [SAVED_SESSION],
    ownership: [],
    ownedRevision: 0,
  };
  const claimNewSession = vi.fn(async (sessionId: string) => {
    if (snapshot.stage !== "authed" || snapshot.ownedIds.includes(sessionId)) {
      return;
    }
    snapshot = {
      ...snapshot,
      ownedIds: [...snapshot.ownedIds, sessionId],
      ownedRevision: snapshot.ownedRevision + 1,
    };
    for (const listener of listeners) listener();
  });
  const controller = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    token: () => "token",
    ownedIds: () => (snapshot.stage === "authed" ? snapshot.ownedIds : []),
    ownerNames: () => new Map(),
    messageAuthorOf: () => undefined,
    claimNewSession,
    signOut: vi.fn(),
  } as unknown as QaAccountsController;
  return { controller, claimNewSession };
}

function accessApi(): QaAccessApi & { current: ReturnType<typeof vi.fn> } {
  return {
    // A real remote decode produces a new object on every call. That identity
    // used to rebuild the session controller after an ownedIds publication.
    current: vi.fn(async () => ({
      ok: true as const,
      value: {
        subroles: [],
        defaultSubrole: "general",
        policy: "selectable" as const,
      },
    })),
    session: vi.fn(async () => ({
      ok: true as const,
      value: {
        subrole: {
          id: "general",
          name: "Общий",
          enabled: true,
          capabilities: {
            tools: { always: [], skillGrantable: [] },
            skills: [],
          },
        },
        adminPreview: false,
      },
    })),
  } as unknown as QaAccessApi & { current: ReturnType<typeof vi.fn> };
}

let route: QaRouteController | undefined;

afterEach(() => {
  route?.dispose();
  route = undefined;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("first send from a new QA chat", () => {
  it("survives the ownership claim and reaches the new session prompt", async () => {
    window.history.replaceState(null, "", "/qa");
    const config = resolveConfig({
      accounts: { enabled: true },
      ui: { showReset: true },
      lockdown: { allowSessionReset: true },
    });
    window.localStorage.setItem(
      `${qaStorageNamespace(config)}:welcome-notice`,
      QA_WELCOME_NOTICE_VERSION,
    );
    window.localStorage.setItem(
      "dsh-qa-surface.session:v1:/qa:session",
      SAVED_SESSION,
    );

    route = new QaRouteController();
    route.configure(config, true);
    const accounts = liveAccounts();
    const access = accessApi();
    const world = harness([SAVED_SESSION]);
    let secureCalls = 0;
    let releaseFirstSend!: () => void;
    world.secureSession.mockImplementation(async (_token, sessionId) => {
      secureCalls += 1;
      // Call 1 opens the restored chat, call 2 binds the lazily materialized
      // chat, and call 3 is send-time attestation. Park the third call so the
      // ownership publication has time to exercise the React effects.
      if (secureCalls === 3) {
        await new Promise<void>((resolve) => {
          releaseFirstSend = resolve;
        });
      }
      return {
        ok: true as const,
        value: {
          sessionId,
          enabled: true,
          agentPresetMatches: true,
          workspaceMatches: true,
          modelMatches: true,
          sandboxModeMatches: true,
          approvalIsNever: true,
          permissionPreset: "qa-read-only" as const,
          toolPolicyLoaded: true,
          toolAllowList: [],
        },
      };
    });
    const configSnapshot = { status: "ready" as const, config, error: null };
    const sectionsSnapshot = { sections: [], revision: 0 };

    render(
      <QaSurface
        {...({
          route,
          config: {
            subscribe: () => () => undefined,
            getSnapshot: () => configSnapshot,
          },
          accounts: accounts.controller,
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
            getSnapshot: () => sectionsSnapshot,
            register: () => () => undefined,
          },
          renderSlot: () => null,
        } as unknown as QaSurfaceProps)}
      />,
    );

    const newChat = await screen.findByRole("button", { name: "Новый чат" });
    await waitFor(() => expect(newChat).toHaveProperty("disabled", false));
    fireEvent.click(newChat);
    const composer = screen.getByRole("combobox");
    fireEvent.change(composer, { target: { value: "Первый вопрос" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => expect(accounts.claimNewSession).toHaveBeenCalled());
    await waitFor(() => expect(world.secureSession).toHaveBeenCalledTimes(3));
    await act(async () => {
      // Let subscriptions, render and passive effects consume the ownership
      // publication before checking that it did not restart access loading.
      await Promise.resolve();
    });
    // Claiming a chat is a list update, not a new login/access principal.
    expect(access.current).toHaveBeenCalledTimes(1);
    // The ownership publication used to dispose the old controller here. Its
    // optimistic row vanished and the empty-chat welcome flashed back before
    // the replacement controller bound, which the runtime probe recorded as
    // QUESTION_TEXT_DISAPPEARED.
    expect(screen.getByText("Первый вопрос")).toBeTruthy();
    expect(screen.queryByText("Чем могу помочь?")).toBeNull();

    await act(async () => {
      releaseFirstSend();
    });
    await waitFor(() => {
      expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
        [{ type: "text", text: "Первый вопрос" }],
        "queue",
      );
    });
  });
});
