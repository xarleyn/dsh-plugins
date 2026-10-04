// @vitest-environment jsdom

/**
 * The card as the Plugins page mounts it.
 *
 * The bundle gate reads the built client as a string, so it can prove which
 * classes are shipped but not that anything renders: a body left wrapped in the
 * list a shell used to need, a card drawn over a namespace the Host cannot read,
 * a write landing on the page's own `{ state, mutate }` instead of the
 * `ConfigForm`, or a second heading repeating the row's own title would keep every
 * string check green. These cases mount the component the entry actually
 * registers, with the owner props the seat spreads over the face.
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { apply } from "../src/client/index.js";
import type { UIRepairRuntime } from "../src/client/runtime.js";
import type { UIRepairPluginConfig } from "../src/shared/config.js";
import { dimensions } from "./runtime.helpers.js";

type Entry = (props: Record<string, unknown>) => ReactElement | string | null;

interface Mounted {
  readonly Entry: Entry;
  readonly face: Record<string, unknown>;
  readonly runtime: UIRepairRuntime;
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

/*
 * `ConfigFormSnapshot.status` is `loading | ready | unavailable`
 * (`@deepseek-ai/dsh-client-ui-settings` `lib/types/client/config-form-types.d.ts:12`),
 * and `value` is undefined until the first accepted section, so the two fixtures
 * the seat reports on its way in and out carry none.
 */
const LOADING: Snapshot = Object.freeze({
  status: "loading",
  value: undefined,
  writable: false,
});
const UNAVAILABLE: Snapshot = Object.freeze({
  status: "unavailable",
  value: undefined,
  writable: false,
});
/*
 * The third state a namespace can be caught in: one that drops back to `loading`
 * while still holding the section it had accepted — `value` is `T | undefined`
 * beside `status`, never narrowed by it, so a resync hands the card a mode it has
 * no right to act on. `STALE_SUGGEST` is that case, and it is the only one of the
 * three that can tell a readiness guard from a shipped default.
 */
const STALE_SUGGEST: Snapshot = Object.freeze({
  status: "loading",
  value: { enabled: true, mode: "suggest" as const },
  writable: false,
});

/**
 * The same namespace read in another state: a store must hand back the same
 * snapshot object until it changes, or React treats every read as an update, so
 * the fixture is frozen and the writes keep the identity the face came with.
 */
function faceForm(
  snapshot: Snapshot,
  original: unknown,
): Record<string, unknown> {
  return {
    ...(original as Record<string, unknown>),
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
  };
}

/** The row's one-liner, which the page prints into its own description `<p>`. */
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
  return {
    Entry,
    face,
    runtime: face["runtime"] as UIRepairRuntime,
    set,
    subscribe,
    dispose,
  };
}

/**
 * One clipped panel the scanner reports, then removed: the issue stays in the
 * runtime's last report, which is the half of the page the settings cannot reach.
 * `data-dsh-ui-repair-scroll` is what lifts the confidence over the repairable
 * threshold, so the issue carries a suggestion and Apply has a reason to exist.
 */
async function scanClippedPanel(runtime: UIRepairRuntime): Promise<void> {
  document.body.innerHTML = `
    <section data-dsh-ui-repair-root="fixture">
      <div id="panel" style="overflow-y: hidden" data-dsh-ui-repair-scroll></div>
    </section>
  `;
  const panel = document.querySelector("#panel") as HTMLElement;
  dimensions(panel, {
    clientHeight: 100,
    scrollHeight: 180,
    clientWidth: 200,
    scrollWidth: 200,
  });
  await act(async () => {
    await runtime.scan();
  });
  document.querySelector('[data-dsh-ui-repair-root="fixture"]')?.remove();
}

/** The owner prop the row seat spreads after the face, and its page-view call. */
function pageForm(value: UIRepairPluginConfig) {
  return {
    state: { status: "ready", value, writable: true },
    mutate: vi.fn(async () => true),
  };
}

/** The page hands this section an empty container, so nothing wraps the body. */
function pageView(
  props: {
    readonly Entry: Entry;
    readonly face: Record<string, unknown>;
    readonly form?: ReturnType<typeof pageForm> | undefined;
  },
  /** A namespace state to answer with, in place of the activation's. */
  snapshot?: Snapshot,
) {
  return render(
    <props.Entry
      {...props.face}
      view="page"
      form={props.form}
      settings={
        snapshot === undefined
          ? props.face["settings"]
          : faceForm(snapshot, props.face["settings"])
      }
    />,
  );
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
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('[data-testid="repair-ui"]')).toBeNull();
    expect(subscribe.mock.calls).toHaveLength(before);
  });

  it("mounts the settings body with no frame, heading or disclosure of its own", async () => {
    mounted = mountEntry();
    const { Entry, face } = mounted;
    const { container } = pageView({ Entry, face });
    await act(async () => {
      await Promise.resolve();
    });

    const body = container.querySelector('[data-testid="repair-ui"]');
    expect(body).not.toBeNull();
    expect(body?.className).toBe("uir-body");
    // The body is what the section mounts, not a card item inside a list of ours.
    expect(container.firstElementChild).toBe(body);
    // The page is the card, so the body arrives already open: nothing to expand.
    expect(container.querySelector("[aria-expanded]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    // The row's title is the page's heading; repeating it here is the second
    // heading the contract forbids.
    expect(container.textContent).not.toContain("UI Repair");
    expect(
      container.querySelector('[data-testid="repair-mode"]'),
    ).not.toBeNull();
  });

  it("writes the field the operator flips through the injected ConfigForm", async () => {
    mounted = mountEntry();
    const { Entry, face, set } = mounted;
    const { container } = pageView({ Entry, face });
    await act(async () => {
      await Promise.resolve();
    });

    const enabled = container.querySelector(
      '[data-testid="repair-toggle-enabled"]',
    ) as HTMLInputElement | null;
    if (enabled === null) throw new Error("the form renders no enable toggle");
    expect(enabled.checked).toBe(true);
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
    const { container } = pageView({ Entry, face, form: page });
    await act(async () => {
      await Promise.resolve();
    });

    const enabled = container.querySelector(
      '[data-testid="repair-toggle-enabled"]',
    ) as HTMLInputElement | null;
    if (enabled === null) throw new Error("the form renders no enable toggle");
    // The drawn policy is the namespace's, not the owner prop's snapshot.
    expect(enabled.checked).toBe(true);
    const mode = container.querySelector(
      '[data-testid="repair-mode"]',
    ) as HTMLSelectElement | null;
    if (mode === null) throw new Error("the form renders no mode control");
    expect(mode.value).toBe("observe");
    fireEvent.click(enabled);
    await act(async () => {
      await Promise.resolve();
    });
    expect(set).toHaveBeenCalledWith("enabled", false);
    expect(page.mutate).not.toHaveBeenCalled();
  });

  it("renders the same body when the seat passes no form at all", async () => {
    mounted = mountEntry();
    const { Entry, face } = mounted;
    // `formFor` answers undefined for a Config that declares no volatile field
    // (`lib/client.js:2688`), so the card may not read the prop to decide to draw.
    const { container } = pageView({ Entry, face, form: undefined });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="repair-ui"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="repair-scan"]'),
    ).not.toBeNull();
  });

  it("disables the write controls, not the body, when the namespace is read-only", async () => {
    mounted = mountEntry({
      status: "ready",
      value: { enabled: true, mode: "observe" },
      writable: false,
    });
    const { Entry, face } = mounted;
    const { container } = pageView({ Entry, face });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="repair-ui"]')).not.toBeNull();
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

  it("answers an unavailable namespace instead of leaving the row empty", async () => {
    mounted = mountEntry();
    const { Entry, face } = mounted;
    const { container } = pageView({ Entry, face }, UNAVAILABLE);
    await act(async () => {
      await Promise.resolve();
    });

    // The page drew the frame and already opened the section, so the card owes a
    // sentence rather than the silence a self-framed card could afford.
    const body = container.querySelector('[data-testid="repair-ui"]');
    expect(body).not.toBeNull();
    const note = container.querySelector(
      '[data-testid="repair-settings-unavailable"]',
    );
    expect(note?.textContent).toContain(
      "are not exposed to this browser session",
    );
    // It promises nothing it cannot honour: no field, no write control.
    expect(container.querySelector('[data-testid="repair-mode"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="repair-ignore-add"]'),
    ).toBeNull();
    // What the settings cannot reach stays reachable: rolling back temporary
    // repairs is a runtime call, and a locked stand is exactly where it matters.
    const rollback = container.querySelector(
      '[data-testid="repair-rollback"]',
    ) as HTMLButtonElement | null;
    if (rollback === null) {
      throw new Error("the body renders no rollback control");
    }
    expect(rollback.disabled).toBe(false);
  });

  it("names the wait instead of drawing defaults while the Host loads", async () => {
    mounted = mountEntry();
    const { Entry, face } = mounted;
    const { container } = pageView({ Entry, face }, LOADING);
    await act(async () => {
      await Promise.resolve();
    });

    const body = container.querySelector('[data-testid="repair-ui"]');
    expect(body).not.toBeNull();
    expect(
      container.querySelector('[data-testid="repair-settings-loading"]'),
    ).not.toBeNull();
    // A resolved default is not the saved policy, so the settings fields wait.
    expect(container.querySelector('[data-testid="repair-mode"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="repair-toggle-enabled"]'),
    ).toBeNull();
    // The scan panel reads the runtime rather than the settings, so it stays;
    // only a scan under a policy nobody has read is withheld.
    const scan = container.querySelector(
      '[data-testid="repair-scan"]',
    ) as HTMLButtonElement | null;
    if (scan === null) throw new Error("the body renders no scan control");
    expect(scan.disabled).toBe(true);
    const rollback = container.querySelector(
      '[data-testid="repair-rollback"]',
    ) as HTMLButtonElement | null;
    if (rollback === null) {
      throw new Error("the body renders no rollback control");
    }
    expect(rollback.disabled).toBe(false);
  });

  it("offers the manual repair actions under the mode the namespace answered", async () => {
    mounted = mountEntry({
      status: "ready",
      value: { enabled: true, mode: "suggest" },
      writable: true,
    });
    const { Entry, face, runtime } = mounted;
    await scanClippedPanel(runtime);
    const { container } = pageView({ Entry, face });
    await act(async () => {
      await Promise.resolve();
    });

    // The pair is not dead markup: with a saved `suggest` mode it is what the
    // row offers, and `runtime.apply` refuses every other mode.
    expect(
      container.querySelectorAll('[data-testid="repair-issue"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="repair-issue-apply"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="repair-issue-ignore"]'),
    ).not.toBeNull();
  });

  it("withholds the mode-gated actions from a namespace that never answered the mode", async () => {
    mounted = mountEntry({
      status: "ready",
      value: { enabled: true, mode: "suggest" },
      writable: true,
    });
    const { Entry, face, runtime } = mounted;
    await scanClippedPanel(runtime);

    for (const state of [LOADING, UNAVAILABLE, STALE_SUGGEST]) {
      const { container, unmount } = pageView({ Entry, face }, state);
      await act(async () => {
        await Promise.resolve();
      });

      // The report belongs to the runtime, so the scan panel keeps it...
      expect(
        container.querySelectorAll('[data-testid="repair-issue"]'),
      ).toHaveLength(1);
      // ...but an action that stands or falls on `mode` may not be drawn from a
      // snapshot the namespace has not accepted. Under `STALE_SUGGEST` this is the
      // assertion that fails without the readiness guard: there the shipped default
      // and a stale value agree that the operator asked for manual repairs, while
      // the row is simultaneously saying the policy arrives once the Host answers.
      expect(
        container.querySelector('[data-testid="repair-issue-apply"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="repair-issue-ignore"]'),
      ).toBeNull();
      unmount();
    }
  });
});
