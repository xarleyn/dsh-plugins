// Shallow render tests of the Sleev settings body. The card sits on the Plugins
// panel row, where the page draws the frame, the heading and the expand control,
// so what these cover is the body the bundle owns: that it mounts without a shell
// of its own (no `dsh-plugin-card*` class, no header toggle, no chevron), draws
// its four fields from the injected face, ignores the seat's shallow `form` owner
// prop, marks staged edits beside the write controls, and reflects each state
// (read-only, dirty, invalid, failed) the way the contract requires.
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  SleevRowConfig,
  SleevSettingsCard,
  type SleevSettingsCardState,
  type SleevSettingsFieldState,
} from "../src/client/index.js";

// The card's entry module re-exports the controller, which builds its store on
// the Host snapshot-store package that the browser bundle carries and this Node
// suite does not resolve. The render tests never construct that store, so a
// stub of the module is enough for the import to load.
vi.mock("@deepseek-ai/dsh-client-store", () => ({
  createSnapshotStore: <T>(initial: T) => {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => value,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set: (next: T) => {
        value = next;
        for (const listener of listeners) listener();
      },
      update: () => {},
    };
  },
}));

function field(
  text: string,
  over: Partial<SleevSettingsFieldState> = {},
): SleevSettingsFieldState {
  return { text, overridden: false, invalid: false, ...over };
}

function cardState(
  over: Partial<SleevSettingsCardState> = {},
): SleevSettingsCardState {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    routes: field("sleev-a"),
    routePrefixes: field("sleev-"),
    maxRecentCalls: field("100"),
    logLevel: field("info"),
    ...over,
  };
}

/** The props the seat hands the card: runtime + locale + the injected face. */
function cardProps(
  over: {
    readonly state?: SleevSettingsCardState;
    readonly form?: unknown;
  } = {},
) {
  const state = over.state ?? cardState();
  return {
    view: "page",
    t: (key: string) => `t:${key}`,
    useSleevSettings: (select: (s: SleevSettingsCardState) => unknown) =>
      select(state),
    edit: vi.fn(),
    resetField: vi.fn(),
    discard: vi.fn(),
    save: vi.fn(),
    // The seat's own owner prop; the card is expected never to read it.
    ...(over.form !== undefined ? { form: over.form } : {}),
  } as unknown as Parameters<typeof SleevSettingsCard>[0];
}

const render = (over: Parameters<typeof cardProps>[0] = {}) =>
  SleevSettingsCard(cardProps(over)) as ReactElement;

function childrenOf(node: ReactElement): ReactElement[] {
  const kids: unknown = node.props.children;
  if (Array.isArray(kids)) return kids.filter(isValidElement);
  return isValidElement(kids) ? [kids] : [];
}

function fieldNode(card: ReactElement, testId: string): ReactElement {
  const node = childrenOf(card).find((child) => child.props.testId === testId);
  if (!isValidElement(node)) throw new Error(`missing field ${testId}`);
  return node as ReactElement;
}

function footer(card: ReactElement): ReactElement {
  const node = childrenOf(card).find(
    (child) => child.props.className === "dsh-sleev-footer",
  );
  if (!isValidElement(node)) throw new Error("missing footer");
  return node as ReactElement;
}

function button(card: ReactElement, testId: string): ReactElement {
  const node = childrenOf(footer(card)).find(
    (child) => child.props["data-testid"] === testId,
  );
  if (!isValidElement(node)) throw new Error(`missing button ${testId}`);
  return node as ReactElement;
}

/** Every element the body renders, including the nested ones it draws itself. */
function elementsOf(node: ReactElement): ReactElement[] {
  return [node, ...childrenOf(node).flatMap(elementsOf)];
}

function classesOf(node: ReactElement): string[] {
  return elementsOf(node)
    .map((element) => element.props.className)
    .filter((name): name is string => typeof name === "string");
}

describe("Sleev settings card render", () => {
  it("mounts the panel body with the four Sleev fields and no shell of ours", () => {
    // The row's detail page draws the card surface, the heading and the expand
    // control, so the body is a plain container with no frame, no header toggle
    // and none of the shell classes a card that owns its chrome carries.
    const card = render();
    expect(card.type).toBe("div");
    expect(card.props["data-testid"]).toBe("sleev-row-config");
    expect(card.props.className).toBe("dsh-sleev-config");
    expect(
      classesOf(card).filter((name) => name.includes("dsh-plugin-card")),
    ).toEqual([]);
    expect(
      elementsOf(card).filter((element) => "aria-expanded" in element.props),
    ).toEqual([]);
    const testIds = childrenOf(card)
      .map((child) => child.props.testId)
      .filter((id): id is string => typeof id === "string")
      .sort();
    expect(testIds).toEqual([
      "sleev-log-level-field",
      "sleev-max-recent-calls-field",
      "sleev-route-prefixes-field",
      "sleev-routes-field",
    ]);
    // A writable namespace gets no read-only notice.
    expect(
      childrenOf(card).find(
        (child) => child.props["data-testid"] === "sleev-read-only",
      ),
    ).toBeUndefined();
  });

  it("draws each control's value from the state the injected face projects", () => {
    const card = render();
    expect(
      fieldNode(card, "sleev-routes-field").props.children.props.value,
    ).toBe("sleev-a");
    expect(
      fieldNode(card, "sleev-max-recent-calls-field").props.children.props
        .value,
    ).toBe("100");
    expect(
      fieldNode(card, "sleev-log-level-field").props.children.props.value,
    ).toBe("info");
  });

  it("ignores the seat's shallow form owner prop and renders from the face", () => {
    // The page hands a `ConfigPageForm` of `{ state, mutate }` whose values
    // differ from the injected face's; if the card read it, the routes field
    // would show the form's value. It shows the face's, which is the full
    // `ConfigForm` resolved from the namespace the seat move cannot orphan.
    const decoyForm = {
      state: {
        status: "ready",
        value: { routes: ["FORM-ROUTE"], writable: true },
      },
      mutate: vi.fn(),
    };
    const card = render({
      state: cardState({ routes: field("FACE-ROUTE") }),
      form: decoyForm,
    });
    expect(
      fieldNode(card, "sleev-routes-field").props.children.props.value,
    ).toBe("FACE-ROUTE");
    expect(decoyForm.mutate).not.toHaveBeenCalled();
  });

  it("states read-only and disables the write path when the namespace cannot be written", () => {
    const card = render({ state: cardState({ writable: false, dirty: true }) });
    expect(
      childrenOf(card).find(
        (child) => child.props["data-testid"] === "sleev-read-only",
      ),
    ).toBeTruthy();
    expect(
      fieldNode(card, "sleev-routes-field").props.children.props.disabled,
    ).toBe(true);
    expect(button(card, "sleev-save").props.disabled).toBe(true);
  });

  it("enables save only for a dirty, valid, writable form that is not saving", () => {
    expect(button(render(), "sleev-save").props.disabled).toBe(true); // clean
    expect(button(render(), "sleev-discard").props.disabled).toBe(true);
    const staged = cardState({ dirty: true });
    expect(button(render({ state: staged }), "sleev-save").props.disabled).toBe(
      false,
    );
    expect(
      button(render({ state: staged }), "sleev-discard").props.disabled,
    ).toBe(false);
    // An invalid or in-flight form cannot be submitted.
    expect(
      button(render({ state: { ...staged, invalid: true } }), "sleev-save")
        .props.disabled,
    ).toBe(true);
    expect(
      button(render({ state: { ...staged, saving: true } }), "sleev-save").props
        .children,
    ).toBe("t:saving");
  });

  it("marks staged edits beside the write controls, where the body can draw them", () => {
    // The old header held the unsaved badge; the page draws this row's heading,
    // so the marker moved into the footer next to the buttons it describes.
    const staged = render({ state: cardState({ dirty: true }) });
    const pill = childrenOf(footer(staged)).find(
      (child) => child.props["data-testid"] === "sleev-unsaved",
    );
    expect(pill?.props.className).toBe("dsh-sleev-pill");
    expect(pill?.props.children).toBe("t:unsaved");
    expect(
      childrenOf(footer(render())).find(
        (child) => child.props["data-testid"] === "sleev-unsaved",
      ),
    ).toBeUndefined();
  });

  it("plumbs an invalid field and reports a failed save in the footer", () => {
    const card = render({
      state: cardState({
        dirty: true,
        invalid: true,
        failed: true,
        maxRecentCalls: field("0", { invalid: true }),
      }),
    });
    const max = fieldNode(card, "sleev-max-recent-calls-field");
    expect(max.props.state.invalid).toBe(true);
    expect(max.props.invalidLabel).toBe("t:invalidNumber");
    expect(
      childrenOf(footer(card)).find(
        (child) => child.props["data-testid"] === "sleev-save-error",
      ),
    ).toBeTruthy();
  });

  it("answers the summary seat with the one-liner and never mounts the card", () => {
    // The row declares no description, so the contract sends this entry to the
    // summary seat; a card there would draw a page within a line.
    const props = {
      view: "summary",
      t: (key: string) => `t:${key}`,
    } as unknown as Parameters<typeof SleevRowConfig>[0];
    expect(SleevRowConfig(props)).toBe("t:description");
  });
});
