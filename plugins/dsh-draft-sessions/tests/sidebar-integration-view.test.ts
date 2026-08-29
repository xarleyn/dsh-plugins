// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_TABS_KEY,
  activateWorkspaceContribution,
} from "../src/client/workspace-contribution.js";
import type { DraftSession } from "../src/shared/types.js";

const draft = {
  version: 1,
  id: "draft-a",
  sessionId: "shell-a",
  workspaceId: "workspace-a",
  title: "Refine onboarding copy",
  text: "Draft the new onboarding flow",
  createdAt: 1,
  updatedAt: 1,
  order: 0,
  state: "ready",
  revision: 1,
} satisfies DraftSession;

function source() {
  const snapshot = [draft] as const;
  const shellSnapshot = new Set(["shell-a"]);
  return {
    getSnapshot: () => snapshot,
    getShellSnapshot: () => shellSnapshot,
    subscribe: vi.fn(() => () => undefined),
    accept: vi.fn(),
    remove: vi.fn(),
  };
}

function props() {
  return {
    wide: true,
    useSessions: <Selected>(
      selector: (state: { current: string }) => Selected,
    ) => selector({ current: "shell-a" }),
    useWorkspaces: <Selected>(
      selector: (state: {
        items: Array<{
          workspaceId: string;
          title: string;
          sessionIds: string[];
        }>;
      }) => Selected,
    ) =>
      selector({
        items: [
          {
            workspaceId: "workspace-a",
            title: "Product website",
            sessionIds: ["shell-a"],
          },
        ],
      }),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("draft sidebar surfaces", () => {
  it("opens the draft list from the stock footer fallback", () => {
    let Footer: ComponentType<any> | undefined;
    const disposers: Array<() => void> = [];
    const ctx = {
      slots: {
        entriesOfSlot: () => [],
        subscribe: vi.fn(() => () => undefined),
        inject: (_name: string, callback: () => () => void) => {
          const dispose = callback();
          disposers.push(dispose);
          return dispose;
        },
        register: (
          options: { name: string },
          component: ComponentType<any>,
        ) => {
          if (options.name === "sidebar.footer.action") Footer = component;
          return () => undefined;
        },
      },
    };
    activateWorkspaceContribution(ctx as never, source() as never);

    render(createElement(Footer!, props()));
    fireEvent.click(screen.getByRole("button", { name: "Drafts (1)" }));

    expect(screen.getByRole("tree", { name: "Draft sessions" })).toBeTruthy();
    expect(screen.getByText("Refine onboarding copy")).toBeTruthy();
    for (const dispose of disposers.reverse()) dispose();
  });

  it("renders drafts in the cooperative tab and suppresses the footer", () => {
    let Footer: ComponentType<any> | undefined;
    let tab: { render(props: Record<string, unknown>): unknown } | undefined;
    const removeTab = vi.fn();
    const registry = {
      version: 1,
      getTabs: () => [],
      subscribe: vi.fn(() => () => undefined),
      insert: vi.fn((value) => {
        tab = value;
        return removeTab;
      }),
    };
    const component = Object.assign(() => null, {
      [NATIVE_TABS_KEY]: registry,
    });
    const disposers: Array<() => void> = [];
    const ctx = {
      slots: {
        entriesOfSlot: () => [{ component }],
        subscribe: vi.fn(() => () => undefined),
        inject: (_name: string, callback: () => () => void) => {
          const dispose = callback();
          disposers.push(dispose);
          return dispose;
        },
        register: (
          options: { name: string },
          registered: ComponentType<any>,
        ) => {
          if (options.name === "sidebar.footer.action") Footer = registered;
          return () => undefined;
        },
      },
    };
    activateWorkspaceContribution(ctx as never, source() as never);

    const view = render(createElement(Footer!, props()));
    expect(screen.queryByRole("button", { name: "Drafts (1)" })).toBeNull();
    view.rerender(tab!.render(props()) as never);
    expect(screen.getByRole("tree", { name: "Draft sessions" })).toBeTruthy();
    expect(screen.getByText("Refine onboarding copy")).toBeTruthy();
    for (const dispose of disposers.reverse()) dispose();
    expect(removeTab).toHaveBeenCalledOnce();
  });
});
