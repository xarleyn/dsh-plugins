// @vitest-environment jsdom

/**
 * The card as the Plugins page mounts it.
 *
 * The bundle gate reads the built client as a string, so it can prove the shell
 * CSS is shipped but not that anything renders: a seat that returned the whole
 * form into the row's one-line paragraph, or an `<li>` left without the list it
 * needs, would keep every string check green. These cases mount the component the
 * entry actually registers and answer both views the page asks it for.
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { apply } from "../src/client/index.js";
import type { UIRepairPluginConfig } from "../src/shared/config.js";

type Entry = (props: Record<string, unknown>) => ReactElement | null;

interface Mounted {
  readonly Entry: Entry;
  readonly face: Record<string, unknown>;
  readonly set: ReturnType<typeof vi.fn>;
  readonly dispose: () => void;
}

const CONFIG: UIRepairPluginConfig = { enabled: true, mode: "observe" };

/** Run the activation and hand back the component the page seats, with its face. */
function mountEntry(): Mounted {
  const snapshot = {
    status: "ready" as const,
    value: CONFIG,
    revision: 7,
    writable: true,
    base: undefined,
    user: undefined,
    mode: "host" as const,
  };
  const set = vi.fn(async () => true);
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    set,
    unset: vi.fn(async () => true),
    mutate: vi.fn(async () => true),
  };
  let Entry: Entry | undefined;
  let face: Record<string, unknown> | undefined;
  const ctx = {
    provide: vi.fn(() => vi.fn(async () => undefined)),
    configForms: { get: vi.fn(() => form) },
    slots: {
      inject: (_name: string, factory: () => unknown) => {
        factory();
        return () => undefined;
      },
      register: (
        _options: Record<string, unknown>,
        component: Entry,
      ): (() => void) => {
        face = {
          ...(_options["inject"] as () => Record<string, unknown>)(),
        };
        Entry = component;
        return () => undefined;
      },
    },
  };
  const dispose = apply(ctx as unknown as Context, {
    document,
    scanOnStartup: false,
    observeMutations: false,
    observeResize: false,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  });
  if (Entry === undefined || face === undefined) {
    throw new Error("the activation never registered an entry");
  }
  return { Entry, face, set, dispose };
}

describe("plugins.row.config seat", () => {
  let mounted: Mounted | undefined;

  afterEach(() => {
    cleanup();
    mounted?.dispose();
    mounted = undefined;
  });

  it("answers the summary view with text the page can seat in its own <p>", () => {
    mounted = mountEntry();
    const { Entry, face } = mounted;
    const { container } = render(
      <p className="detail-desc">
        <Entry {...face} view="summary" />
      </p>,
    );

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe("Repair mode: observe");
    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
    expect(container.querySelector('[data-testid="repair-ui"]')).toBeNull();
  });

  it("renders the shell inside the list it owns for the page view", () => {
    mounted = mountEntry();
    const { Entry, face } = mounted;
    const { container } = render(<Entry {...face} view="page" />);
    act(() => undefined);

    const list = container.querySelector("ul.uir-list");
    const card = container.querySelector(".dsh-plugin-card");
    expect(list).not.toBeNull();
    expect(list?.firstElementChild).toBe(card);
    expect(card?.tagName).toBe("LI");
    expect(
      card?.querySelector(".dsh-plugin-card__name")?.textContent,
    ).toContain("UI Repair");
  });

  it("opens the form on its header and writes the field the operator flips", async () => {
    mounted = mountEntry();
    const { Entry, face, set } = mounted;
    const { container } = render(<Entry {...face} view="page" />);
    await act(async () => {
      await Promise.resolve();
    });

    const header = container.querySelector("button.dsh-plugin-card__header");
    if (header === null) throw new Error("the shell renders no header button");
    expect(header.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(header);
    expect(container.querySelector(".dsh-plugin-card")?.className).toContain(
      "dsh-plugin-card--open",
    );
    expect(container.querySelector(".uir-body")).not.toBeNull();

    const enabled = container.querySelector(
      '[data-testid="repair-toggle-enabled"]',
    ) as HTMLInputElement | null;
    if (enabled === null) throw new Error("the form renders no enable toggle");
    fireEvent.click(enabled);
    await act(async () => {
      await Promise.resolve();
    });
    expect(set).toHaveBeenCalledWith("enabled", false);
  });

  it("draws no card when the Host reports no settings for the namespace", () => {
    mounted = mountEntry();
    const { Entry, face } = mounted;
    // A store must hand back the same snapshot object until it changes, or React
    // treats every read as an update.
    const unavailable = Object.freeze({ status: "unavailable" });
    const { container } = render(
      <Entry
        {...face}
        settings={{
          getSnapshot: () => unavailable,
          subscribe: () => () => undefined,
          set: vi.fn(),
          unset: vi.fn(),
          mutate: vi.fn(),
        }}
        view="page"
      />,
    );
    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
    expect(container.querySelector("ul.uir-list")?.children).toHaveLength(0);
  });
});
