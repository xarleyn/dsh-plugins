// @vitest-environment jsdom

/**
 * The card as the Plugins page mounts it.
 *
 * The bundle gate reads the built client as a string, so it can prove the shell
 * CSS is shipped but not that anything renders: an `<li>` left without the list it
 * needs, a card drawn over a namespace the Host cannot read, or a write that
 * lands on the page's own `{ state, mutate }` instead of the `ConfigForm` would
 * keep every string check green. These cases mount the component the entry
 * actually registers, with the owner props the seat spreads over the face.
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { apply } from "../src/client/index.js";
import type { UIRepairPluginConfig } from "../src/shared/config.js";

type Entry = (props: Record<string, unknown>) => ReactElement | string | null;

interface Mounted {
  readonly Entry: Entry;
  readonly face: Record<string, unknown>;
  readonly set: ReturnType<typeof vi.fn>;
  readonly subscribe: ReturnType<typeof vi.fn>;
  readonly dispose: () => void;
}

const ROW_SUMMARY =
  "Observe layout defects and apply reversible, scoped repairs.";

interface Snapshot {
  readonly status: string;
  readonly value: UIRepairPluginConfig | undefined;
  readonly writable: boolean;
}

/** The one-liner the page seats under the row heading, in its own `<p>`. */
function summaryLine(props: {
  readonly Entry: Entry;
  readonly face: Record<string, unknown>;
}) {
  return render(
    <p className="detail-desc">
      <props.Entry {...props.face} view="summary" />
    </p>,
  );
}

/** Run the activation and hand back the component the page seats, with its face. */
function mountEntry(
  snapshot: Snapshot = {
    status: "ready",
    value: { enabled: true, mode: "observe" },
    writable: true,
  },
): Mounted {
  const set = vi.fn(async () => true);
  const subscribe = vi.fn(() => () => undefined);
  const form = {
    getSnapshot: () => snapshot,
    subscribe,
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
  return { Entry, face, set, subscribe, dispose };
}

/** The owner prop the row seat spreads after the face, and its page-view call. */
function pageForm(value: UIRepairPluginConfig) {
  return {
    state: { status: "ready", value, writable: true },
    mutate: vi.fn(async () => true),
  };
}

describe("plugins.row.config seat", () => {
  let mounted: Mounted | undefined;

  afterEach(() => {
    cleanup();
    mounted?.dispose();
    mounted = undefined;
  });

  it("answers the summary view with the row's sentence and nothing but words", () => {
    mounted = mountEntry();
    const { Entry, face, subscribe } = mounted;
    // The activation itself subscribes the form it resolved (`index.ts:64`); the
    // fallback must add no reader of its own.
    const before = subscribe.mock.calls.length;
    const { container } = summaryLine({ Entry, face });

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe(ROW_SUMMARY);
    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
    expect(container.querySelector('[data-testid="repair-ui"]')).toBeNull();
    expect(subscribe.mock.calls).toHaveLength(before);
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
    expect(
      card?.querySelector(".dsh-plugin-card__description")?.textContent,
    ).toBe(ROW_SUMMARY);
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

  it("reads and writes the injected ConfigForm over the seat's own form prop", async () => {
    mounted = mountEntry();
    const { Entry, face, set } = mounted;
    // What the page passes at `lib/client.js:1852`, and the only thing it can
    // pass: `{ state, mutate }`. Its values are a different policy on purpose.
    const page = pageForm({ enabled: false, mode: "suggest" });
    const { container } = render(<Entry {...face} view="page" form={page} />);
    await act(async () => {
      await Promise.resolve();
    });

    const header = container.querySelector("button.dsh-plugin-card__header");
    if (header === null) throw new Error("the shell renders no header button");
    fireEvent.click(header);
    const enabled = container.querySelector(
      '[data-testid="repair-toggle-enabled"]',
    ) as HTMLInputElement | null;
    if (enabled === null) throw new Error("the form renders no enable toggle");
    // The drawn policy is the namespace's, not the owner prop's snapshot.
    expect(enabled.checked).toBe(true);
    fireEvent.click(enabled);
    await act(async () => {
      await Promise.resolve();
    });
    expect(set).toHaveBeenCalledWith("enabled", false);
    expect(page.mutate).not.toHaveBeenCalled();
  });

  it("renders the same card when the seat passes no form at all", async () => {
    mounted = mountEntry();
    const { Entry, face } = mounted;
    // `formFor` answers undefined for a Config that declares no volatile field
    // (`lib/client.js:2688`), so the card may not read the prop to decide to draw.
    const { container } = render(
      <Entry {...face} view="page" form={undefined} />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector(".dsh-plugin-card")).not.toBeNull();
    const header = container.querySelector("button.dsh-plugin-card__header");
    if (header === null) throw new Error("the shell renders no header button");
    fireEvent.click(header);
    expect(container.querySelector('[data-testid="repair-ui"]')).not.toBeNull();
  });

  it("disables the write controls, not the card, when the namespace is read-only", () => {
    mounted = mountEntry({
      status: "ready",
      value: { enabled: true, mode: "observe" },
      writable: false,
    });
    const { Entry, face } = mounted;
    const { container } = render(<Entry {...face} view="page" />);

    expect(container.querySelector(".dsh-plugin-card")).not.toBeNull();
    const header = container.querySelector("button.dsh-plugin-card__header");
    if (header === null) throw new Error("the shell renders no header button");
    fireEvent.click(header);
    const enabled = container.querySelector(
      '[data-testid="repair-toggle-enabled"]',
    ) as HTMLInputElement | null;
    if (enabled === null) throw new Error("the form renders no enable toggle");
    expect(enabled.disabled).toBe(true);
    const add = container.querySelector(
      '[data-testid="repair-ignore-add"]',
    ) as HTMLButtonElement | null;
    if (add === null) throw new Error("the form renders no ignore control");
    expect(add.disabled).toBe(true);
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
