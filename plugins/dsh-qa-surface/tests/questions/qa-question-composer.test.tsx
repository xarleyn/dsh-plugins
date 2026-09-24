// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaRouteController } from "../../src/client/QaRouteController.js";
import { QaSurface, type QaSurfaceProps } from "../../src/client/QaSurface.js";
import { QaAuditController } from "../../src/client/audit/controller.js";
import { QaSurfacePanelRegistry } from "../../src/client/panels/registry.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type { QaAccountsController } from "../../src/client/QaAccountsController.js";
import type { QaAccessApi } from "../../src/client/types.js";
import { QA_WELCOME_NOTICE_VERSION } from "../../src/client/components/QaWelcomeNotice.js";
import { qaStorageNamespace } from "../../src/shared/session-key.js";
import { harness } from "../helpers/session-fakes.js";

// jsdom has no ResizeObserver; the chat surface's width handles observe it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

/**
 * A question the model is waiting on owns the composer: the operator answers
 * the tool call that is already open, and text sent beside it would start a
 * second turn. The composer keeps its draft, so it is hidden behind the form
 * rather than unmounted.
 */

const SESSION = "session-a";

const PARKED = {
  id: "question-1",
  sessionId: SESSION,
  createdAt: 1,
  questions: [
    {
      id: "target",
      question: "Куда писать отчёт?",
      header: null,
      detail: null,
      multiSelect: false,
      options: [{ label: "В чат", description: null }],
    },
  ],
};

function accounts(): QaAccountsController {
  // One snapshot per state: a store that builds a fresh object on every read
  // makes React re-render forever.
  const snapshot = {
    stage: "authed" as const,
    user: {
      id: "u1",
      email: "user@example.com",
      displayName: "user",
      role: "user" as const,
      createdAt: "2026-09-16T00:00:00.000Z",
      lastLoginAt: null,
      disabled: false,
      profile: {
        fullName: "Пользователь",
        identities: {},
        instructions: "",
        updatedAt: null,
      },
      starters: { items: [], hideDefaults: false },
    },
    ownedIds: [SESSION],
    ownership: [],
    ownedRevision: 0,
  };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    token: () => "token",
    ownedIds: () => [SESSION],
    ownerNames: () => new Map(),
    messageAuthorOf: () => undefined,
    claimNewSession: vi.fn(),
    signOut: vi.fn(),
  } as unknown as QaAccountsController;
}

function accessApi(): QaAccessApi {
  return {
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
  } as unknown as QaAccessApi;
}

let route: QaRouteController | undefined;

afterEach(() => {
  route?.dispose();
  route = undefined;
});

describe("the composer while a question is parked", () => {
  it("gives the form the composer's place and keeps the run stoppable", async () => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/qa");
    const config = resolveConfig({
      accounts: { enabled: true },
      interaction: { questions: "interactive" },
    });
    window.localStorage.setItem(
      `${qaStorageNamespace(config)}:welcome-notice`,
      QA_WELCOME_NOTICE_VERSION,
    );
    route = new QaRouteController();
    route.configure(config, true);
    const world = harness([SESSION]);
    window.localStorage.setItem(
      "dsh-qa-surface.session:v1:/qa:session",
      SESSION,
    );
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", SESSION);
    const face = world.faces.get(SESSION);
    face?.source.set({
      ...face.source.getSnapshot(),
      blank: false,
      running: true,
    });

    const answerQuestion = vi.fn(async () => ({
      ok: true as const,
      value: true,
    }));
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
          accounts: accounts(),
          accessApi: accessApi(),
          sessions: world.sessions,
          api: world.api,
          conversation: world.conversation,
          connection: world.connection,
          secureSession: world.secureSession,
          createSession: world.createSession,
          sourceApi: {
            sources: vi.fn(async () => ({ ok: true as const, value: [] })),
            readSourceFile: vi.fn(),
          },
          questionApi: {
            pendingQuestions: vi.fn(async () => ({
              ok: true as const,
              value: [PARKED],
            })),
            answerQuestion,
            cancelQuestion: vi.fn(async () => ({
              ok: true as const,
              value: true,
            })),
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

    // The form appears in the composer's place.
    expect(await screen.findByText("Куда писать отчёт?")).toBeDefined();
    const slot = document.querySelector(".dsh-qa-composer-slot");
    expect(slot?.hasAttribute("hidden")).toBe(true);
    // The run's own stop action stays reachable while the form owns the slot.
    fireEvent.click(screen.getByText("Остановить"));
    await waitFor(() => {
      expect(face?.cancel).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText("В чат"));
    fireEvent.click(screen.getByText("Отправить"));
    await waitFor(() => {
      expect(answerQuestion).toHaveBeenCalledWith(
        "token",
        SESSION,
        "question-1",
        [{ id: "target", selected: ["В чат"] }],
      );
    });
  });
});
