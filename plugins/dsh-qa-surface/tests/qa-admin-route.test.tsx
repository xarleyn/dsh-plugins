// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaRouteController } from "../src/client/QaRouteController.js";
import { QaSurface, type QaSurfaceProps } from "../src/client/QaSurface.js";
import { QaSurfacePanelRegistry } from "../src/client/panels/registry.js";
import { resolveConfig } from "../src/resolve-config.js";
import type { QaAccessApi, QaAdminApi } from "../src/client/types.js";
import type { QaAccountsController } from "../src/client/QaAccountsController.js";
import type { QaConfigController } from "../src/client/QaConfigController.js";
import type { QaAdminOverview, QaConversationSummary } from "../src/types.js";
import { harness } from "./helpers/session-fakes.js";

// jsdom has no ResizeObserver; the chat surface's width handles observe it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

/**
 * The surface hosting the console must stay the console while the console
 * walks its own sections: every entry in its navigation is another pathname
 * under `/qa/admin`. A surface that recognises only the bare base unmounts the
 * console on the first click (and on every pasted deep link), which is exactly
 * what the chat surface looks like: the console simply disappears.
 */

const OVERVIEW: QaAdminOverview = {
  metrics: {
    conversations: 0,
    activeUsers: 0,
    assistantMessages: 0,
    ratedMessages: 0,
    positiveRatings: 0,
    negativeRatings: 0,
    ratingRate: 0,
    positiveRate: 0,
    unreviewedNegatives: 0,
    reviewedItems: 0,
    issues: [],
    bySubrole: [],
    trend: [],
  },
  alerts: [],
  recentFeedback: [],
  queue: [],
};

const SUMMARY = {} as QaConversationSummary;

function accessApi(): QaAccessApi {
  return {
    current: vi.fn(async () => ({
      ok: true as const,
      value: {
        subroles: [
          {
            id: "analyst",
            name: "Аналитик",
            enabled: true,
            capabilities: {
              tools: { always: [], skillGrantable: [] },
              skills: [],
            },
          },
        ],
        defaultSubrole: "analyst",
        policy: "selectable" as const,
      },
    })),
    session: vi.fn(),
    admin: vi.fn(async () => ({
      ok: true as const,
      value: {
        config: {
          version: 1 as const,
          common: { tools: { always: [], skillGrantable: [] }, skills: [] },
          subroles: [],
          skillOverrides: [],
        },
        systemRequired: {
          tools: { always: [], skillGrantable: [] },
          skills: [],
        },
        catalog: [],
        skills: [],
        users: [],
        audit: [],
      },
    })),
    createSubrole: vi.fn(),
    updateSubrole: vi.fn(),
    deleteSubrole: vi.fn(),
    updateCommon: vi.fn(),
    updateAssignment: vi.fn(),
    updateSkillOverride: vi.fn(),
    skillActivations: vi.fn(),
  } as unknown as QaAccessApi;
}

function adminApi(): QaAdminApi {
  const page = <T,>(items: readonly T[]) => ({
    ok: true as const,
    value: { items, nextCursor: null, total: items.length },
  });
  return {
    overview: vi.fn(async () => ({ ok: true as const, value: OVERVIEW })),
    users: vi.fn(async () => page([])),
    user: vi.fn(async () => ({
      ok: false as const,
      error: new Error("unused"),
    })),
    updateUser: vi.fn(),
    conversations: vi.fn(async () => page([SUMMARY])),
    conversation: vi.fn(async () => ({
      ok: false as const,
      error: new Error("unused"),
    })),
    feedback: vi.fn(async () => page([])),
    rateMessage: vi.fn(),
    reviewQueue: vi.fn(async () => page([])),
    queueConversation: vi.fn(),
    saveReview: vi.fn(),
    metrics: vi.fn(async () => ({
      ok: true as const,
      value: OVERVIEW.metrics,
    })),
    audit: vi.fn(async () => page([])),
  } as unknown as QaAdminApi;
}

/** The account the console is opened by; the surface reads its role only. */
function accounts(): QaAccountsController {
  // A store must hand back one identity per state, or React re-renders forever.
  const snapshot = {
    stage: "authed" as const,
    user: {
      id: "u1",
      email: "admin@example.com",
      displayName: "admin",
      role: "admin" as const,
      createdAt: "2026-09-16T00:00:00.000Z",
      lastLoginAt: null,
      disabled: false,
      profile: {
        fullName: "Админ",
        identities: {},
        instructions: "",
        updatedAt: null,
      },
      starters: { items: [], hideDefaults: false },
    },
    ownedIds: [],
    ownership: [],
    ownedRevision: 0,
  };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    token: () => "token",
    ownedIds: () => [],
    ownerNames: () => new Map(),
    messageAuthorOf: () => undefined,
    claimNewSession: vi.fn(),
    signOut: vi.fn(),
  } as unknown as QaAccountsController;
}

let route: QaRouteController | undefined;

afterEach(() => {
  route?.dispose();
  route = undefined;
});

/** The surface as the page mounts it at one pathname. */
function surfaceAt(pathname: string): QaSurfaceProps {
  window.history.replaceState(null, "", pathname);
  const config = resolveConfig({ accounts: { enabled: true } });
  route = new QaRouteController();
  route.configure(config, true);
  const configSnapshot = { status: "ready" as const, config, error: null };
  const sectionsSnapshot = { sections: [], revision: 0 };
  const world = harness();
  return {
    route,
    config: {
      subscribe: () => () => undefined,
      getSnapshot: () => configSnapshot,
    } as unknown as QaConfigController,
    accounts: accounts(),
    accessApi: accessApi(),
    adminApi: adminApi(),
    sessions: world.sessions,
    api: world.api,
    conversation: world.conversation,
    connection: world.connection,
    secureSession: world.secureSession,
    createSession: world.createSession,
    sourceApi: {
      // A chat whose host stores no source bundle: no refusal to report.
      sources: vi.fn(async () => ({ ok: true as const, value: [] })),
      readSourceFile: vi.fn(async () => ({
        ok: false as const,
        error: new Error("unused"),
      })),
    },
    panels: new QaSurfacePanelRegistry(),
    settingsSections: {
      subscribe: () => () => undefined,
      getSnapshot: () => sectionsSnapshot,
      register: () => () => undefined,
    },
    renderSlot: () => null,
  } as unknown as QaSurfaceProps;
}

describe("the surface that hosts the admin console", () => {
  it("keeps the console mounted while its own navigation walks the sections", async () => {
    render(<QaSurface {...surfaceAt("/qa/admin")} />);
    const nav = await screen.findByRole("navigation", {
      name: "Разделы администрирования",
    });

    fireEvent.click(within(nav).getByRole("button", { name: "Пользователи" }));

    await waitFor(() =>
      expect(window.location.pathname).toBe("/qa/admin/users"),
    );
    expect(document.querySelector(".dsh-qa-admin")).toBeTruthy();
    // The chat surface is what the console used to fall back to.
    expect(document.querySelector(".dsh-qa-surface")).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "Пользователи" }),
    ).toBeTruthy();
  });

  it("opens a deep link straight into its section", async () => {
    render(<QaSurface {...surfaceAt("/qa/admin/review")} />);
    const nav = await screen.findByRole("navigation", {
      name: "Разделы администрирования",
    });
    // The pasted link lands on the section it names, not on the overview.
    expect(
      within(nav)
        .getByRole("button", { name: "Очередь разбора" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(document.querySelector(".dsh-qa-admin")).toBeTruthy();
    expect(document.querySelector(".dsh-qa-surface")).toBeNull();
  });

  it("leaves the chat surface in charge outside the console", async () => {
    render(<QaSurface {...surfaceAt("/qa")} />);
    expect(document.querySelector(".dsh-qa-admin")).toBeNull();
    expect(document.querySelector(".dsh-qa-surface")).toBeTruthy();
  });
});
