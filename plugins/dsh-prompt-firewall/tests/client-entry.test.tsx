// @vitest-environment jsdom

/**
 * The two views the Plugins page seats this entry in. `summary` is placed
 * inside the page's own `<p>`, so only text may come back; `page` renders the
 * body alone, because the row-detail page draws the card surface, the heading
 * and the expand control itself (AGENTS.md card contract). The card writes
 * through the form the bundle resolved under the unchanged namespace, never
 * through the `ConfigPageForm` the seat spreads over its face, and says so in a
 * sentence while the namespace reports `unavailable`.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { apply } from "../src/client/index.js";
import type { PromptFirewallConfig } from "../src/types.js";

type Seat = (props: Record<string, unknown>) => ReactElement | string | null;

/*
 * The row's sentence as the Host reads it: the exported locale's `meta.description`,
 * which the page puts in its own `<p>` before the seat is ever asked for it.
 * Resolved through `fileURLToPath` because the jsdom environment replaces the
 * global `URL`, and Node's `readFileSync` only recognises its own.
 */
const ROW_DESCRIPTION = (
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "locale", "en.json"),
      "utf8",
    ),
  ) as { meta: { description: string } }
).meta.description;

const CONFIG: PromptFirewallConfig = { enabled: true, mode: "blocklist" };

/** Each activation injects its styles and mounts the Remote; both end here. */
const activations: Array<() => Promise<void>> = [];

/** Run the activation and hand back the component the page would seat. */
async function mountSeat(
  /** How the namespace answers, for a card that owes a sentence instead of a form. */
  snapshotOverrides: Record<string, unknown> = {},
) {
  let snapshot = {
    status: "ready",
    value: CONFIG,
    revision: 7,
    writable: true,
    base: undefined,
    user: undefined,
    mode: "host",
    ...snapshotOverrides,
  };
  const listeners = new Set<() => void>();
  const form = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
    mutate: vi.fn(async () => true),
  };
  const inspect = vi.fn(async () => ({
    ok: false,
    error: "inspector offline",
  }));
  const setSectionPolicy = vi.fn(async () => ({ ok: true, value: undefined }));
  let Entry: Seat | undefined;
  let face: Record<string, unknown> | undefined;

  const readyCtx = {
    remote: { promptFirewall: { inspect, setSectionPolicy } },
    slots: {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: (options: Record<string, unknown>, component: Seat) => {
        face = (options["inject"] as () => Record<string, unknown>)();
        Entry = component;
        return () => undefined;
      },
    },
  };

  const disposeRemote = vi.fn(async () => undefined);
  const dispose = await apply({
    remote: { $mount: async () => disposeRemote },
    inject: async (
      _dependencies: string[],
      callback: (ctx: typeof readyCtx) => unknown,
    ) => {
      callback(readyCtx);
    },
    configForms: { get: () => form },
    slots: readyCtx.slots,
  } as never);

  if (Entry === undefined || face === undefined) {
    throw new Error("the activation never registered an entry");
  }
  activations.push(dispose);
  return {
    Entry,
    face,
    form,
    inspect,
    update: (changes: typeof snapshotOverrides) => {
      snapshot = { ...snapshot, ...changes };
      for (const listener of listeners) listener();
    },
  };
}

describe("plugins.row.config seat", () => {
  afterEach(async () => {
    cleanup();
    const pending = activations.splice(0);
    for (const dispose of pending) await dispose();
  });

  it("answers the summary view with text the page can seat in its own <p>", async () => {
    const { Entry, face, inspect } = await mountSeat();
    const { container } = render(
      <p className="detail-desc">
        <Entry {...face} view="summary" />
      </p>,
    );

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    // Byte-equal to the exported metadata field, read here rather than repeated: the page
    // writes that field into this same `<p>` whenever the row carries a
    // description, so a sentence of our own would make one row read as two. A
    // literal in this test cannot catch an edit to the metadata; this can.
    expect(paragraphs[0]?.textContent).toBe(ROW_DESCRIPTION);
    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
  });

  it("mounts the settings body directly, with no shell of our own", async () => {
    const { Entry, face } = await mountSeat();
    const { container } = render(<Entry {...face} view="page" />);
    // The mount effect reads the inspector at once, so let that land inside act.
    await act(async () => {
      await Promise.resolve();
    });

    const body = container.querySelector(".pf-body");
    expect(body).not.toBeNull();
    // The row-detail page draws the frame, the heading and the expand control, so
    // repeating any of them here is the second frame this seat forbids.
    expect(container.querySelector(".dsh-plugin-card")).toBeNull();
    expect(container.querySelector("button[aria-expanded]")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    // The body is mounted at once, not held behind a header the user must open.
    expect(container.querySelector('[data-testid="pf-error"]')).not.toBeNull();
  });

  it("writes through the form the bundle resolved, not the seat's own", async () => {
    const { Entry, face, form } = await mountSeat();
    // The page renders its registrant with these owner props spread after the
    // face (`RowDetail` passes `form` beside `view`), and `ConfigPageForm` is
    // `{ state, mutate }` over a snapshot: no subscription, no single-field write.
    const ownerForm = {
      state: { status: "ready", value: CONFIG, revision: 99, writable: true },
      mutate: vi.fn(async () => true),
    };
    const { container } = render(
      <Entry {...face} view="page" form={ownerForm} />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    const enabled = container.querySelector<HTMLInputElement>(
      '[data-testid="pf-policy-enabled"]',
    );
    if (enabled === null || enabled === undefined) {
      throw new Error("the policy section renders no enable switch");
    }

    fireEvent.click(enabled);
    expect(form.set).toHaveBeenCalledWith("enabled", false);
    expect(ownerForm.mutate).not.toHaveBeenCalled();
  });

  it("reads saved values and follows read-only changes without hiding the body", async () => {
    const saved: PromptFirewallConfig = { enabled: false, mode: "audit" };
    const { Entry, face, form, update } = await mountSeat({
      value: saved,
      writable: false,
    });
    const { container } = render(<Entry {...face} view="page" />);
    await act(async () => {
      await Promise.resolve();
    });

    const enabled = container.querySelector<HTMLInputElement>(
      '[data-testid="pf-policy-enabled"]',
    );
    const mode = container.querySelector<HTMLSelectElement>(
      '[data-testid="pf-policy-mode"]',
    );
    expect(enabled).toHaveProperty("checked", false);
    expect(mode).toHaveProperty("value", "audit");
    expect(enabled).toHaveProperty("disabled", true);
    expect(mode).toHaveProperty("disabled", true);
    expect(container.querySelector(".pf-body")).not.toBeNull();
    act(() => {
      enabled!.click();
    });
    expect(form.set).not.toHaveBeenCalled();

    await act(async () => {
      update({ writable: true });
    });
    expect(enabled).toHaveProperty("disabled", false);
    fireEvent.click(enabled!);
    expect(form.set).toHaveBeenCalledWith("enabled", true);

    await act(async () => {
      update({ value: { ...saved, enabled: true }, revision: 8 });
    });
    expect(enabled).toHaveProperty("checked", true);
  });

  it("says why in a sentence while the row's namespace answers unavailable", async () => {
    const { Entry, face, form, inspect } = await mountSeat({
      status: "unavailable",
      value: undefined,
    });
    const { container } = render(<Entry {...face} view="page" />);
    await act(async () => {
      await Promise.resolve();
    });

    // The frame is the page's and it is already open, so an empty answer would
    // leave the reader in a section with no content and no reason.
    const sentence = container.querySelector(
      '[data-testid="pf-settings-unavailable"]',
    );
    expect(sentence).not.toBeNull();
    expect(container.textContent).toContain("firewall keeps enforcing");
    // The sentence is about the settings the namespace withholds. The inspector
    // Remote is not withheld with them and keeps being polled in the background, so
    // a claim that nothing here can be read would promise more than this branch does.
    expect(sentence?.textContent).toContain("cannot read or write");
    expect(sentence?.textContent).not.toMatch(/nothing here can be read/iu);
    expect(
      container.querySelector('[data-testid="pf-policy-enabled"]'),
    ).toHaveProperty("disabled", true);
    expect(inspect).toHaveBeenCalledOnce();
    expect(form.set).not.toHaveBeenCalled();
  });
});
