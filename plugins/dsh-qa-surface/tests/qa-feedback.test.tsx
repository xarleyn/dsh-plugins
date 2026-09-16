// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaRouteController } from "../src/client/QaRouteController.js";
import { QaSurface, type QaSurfaceProps } from "../src/client/QaSurface.js";
import { QaSurfacePanelRegistry } from "../src/client/panels/registry.js";
import { resolveConfig } from "../src/resolve-config.js";
import type { QaAccessApi, QaAdminApi } from "../src/client/types.js";
import type { QaAccountsController } from "../src/client/QaAccountsController.js";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { harness } from "./helpers/session-fakes.js";
import { legacy, snapshot } from "./helpers/conversation-fakes.js";
import { qaStorageNamespace } from "../src/shared/session-key.js";
import { QA_WELCOME_NOTICE_VERSION } from "../src/client/components/QaWelcomeNotice.js";

// jsdom has no ResizeObserver; the chat surface's width handles observe it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

/**
 * The rating a user gives in the chat has to reach the Host: the answer is
 * filed under its durable log position, which is the one identity the stored
 * log and the browser transcript agree on. A message that reaches the surface
 * without that position is silently unratable — the thumbs state still moves
 * in localStorage, so the loss is invisible unless this path is covered.
 */

const SESSION = "session-a";

function accounts(): QaAccountsController {
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

describe("rating an answer from the chat surface", () => {
  it("files the rating under the answer's durable log position", async () => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/qa");
    const config = resolveConfig({ accounts: { enabled: true } });
    // The welcome disclosure is once per browser; this test is about the
    // message footer, not the overlay in front of it.
    window.localStorage.setItem(
      `${qaStorageNamespace(config)}:welcome-notice`,
      QA_WELCOME_NOTICE_VERSION,
    );
    route = new QaRouteController();
    route.configure(config, true);
    const world = harness([SESSION]);
    // The surface persists its chat choice in the browser, so the stored id has
    // to be there or the first render opens a brand-new chat instead.
    window.localStorage.setItem(
      "dsh-qa-surface.session:v1:/qa:session",
      SESSION,
    );
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", SESSION);
    const face = world.faces.get(SESSION);
    face?.source.set({ ...face.source.getSnapshot(), blank: false });
    world.bindings.get(SESSION)?.snapshot.set(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "assistant",
              seq: 21,
              time: 1_000,
              turn: 1,
              step: 1,
              blocks: [{ kind: "text", text: "Answer" }],
            },
          ] as ConversationNode[],
        }),
      ),
    );
    const rateMessage = vi.fn(async () => ({
      ok: true as const,
      value: {
        id: "feedback",
        conversationId: SESSION,
        messageId: "21",
        userId: "u1",
        rating: "positive" as const,
        createdAt: "2026-09-16T00:00:00.000Z",
      },
    }));
    // A store must hand back one snapshot per state, or React re-renders forever.
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
          adminApi: { rateMessage } as unknown as QaAdminApi,
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
          panels: new QaSurfacePanelRegistry(),
          settingsSections: {
            subscribe: () => () => undefined,
            getSnapshot: () => sectionsSnapshot,
            register: () => () => undefined,
          },
          renderSlot: () => null,
        } as unknown as QaSurfaceProps)}
      />,
    );

    const like = await screen.findByRole("button", { name: "Нравится" });
    fireEvent.click(like);

    await waitFor(() =>
      expect(rateMessage).toHaveBeenCalledWith("token", SESSION, "21", {
        rating: "positive",
      }),
    );
  });
});
