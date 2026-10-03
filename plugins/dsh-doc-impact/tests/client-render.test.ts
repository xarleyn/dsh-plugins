// What the card actually draws, field by field. `SPECS`, the schema and the
// section all agree by construction (`settings.test.ts` pins that), but nothing
// joined the spec list to the ten `createElement` calls in `card.ts`: a field
// could appear in the schema, in the section and in the specs and still never
// reach the screen, and a field could be drawn by a renderer its own kind cannot
// carry. These are the pins for that, plus the two for a choice whose stored value
// is outside its vocabulary — the select then has no option to mark selected,
// which reads on screen as an empty box, and the card answers it with its default.
// The last pair runs the same checks one level up, through the entry the Plugins
// row seat registers, so the view dispatch cannot drop a prop in silence.
import { describe, expect, it, vi } from "vitest";

interface Rendered {
  readonly type: unknown;
  readonly props: Record<string, any>;
  readonly children: unknown[];
}

const tree: Rendered[] = vi.hoisted(() => [] as Rendered[]);

vi.mock("react", () => ({
  createElement: (
    type: unknown,
    props: Record<string, any> | null,
    ...children: unknown[]
  ) => {
    const entry: Rendered = { type, props: props ?? {}, children };
    tree.push(entry);
    return entry;
  },
}));

import {
  CardSummary,
  ConfigCard,
  RowConfigEntry,
  type RowEntryProps,
} from "../src/client/card.js";
import {
  BoolField,
  ChoiceField,
  NumberField,
  TextAreaField,
  TextField,
} from "../src/client/fields.js";
import {
  FIELDS,
  SettingsForm,
  type CardSnapshot,
  type FieldSpec,
  type NamespaceForm,
  type NamespaceSnapshot,
} from "../src/client/settings-form.js";

/**
 * A namespace document whose two choice fields hold a value the vocabulary does
 * not accept — what an entry config edited outside the card, or a schema whose
 * union lost a literal, leaves behind.
 */
const HOSTILE: NamespaceSnapshot = {
  status: "ready",
  value: {
    configFile: ".dsh/doc-impact.yml",
    defaults: { mode: "require-attention" },
    safety: { onLimit: "shrink" },
    changeDetection: { maxSnapshotFiles: 300 },
  },
  base: { defaults: { mode: "require-update" } },
  user: { defaults: { mode: "require-attention" } },
  writable: true,
  revision: 4,
  mode: "host",
};

/** A host form that never writes: the render pass must not reach the wire. */
function readOnlyForm(snapshot: NamespaceSnapshot): NamespaceForm {
  const refuse = async (): Promise<boolean> => {
    throw new Error("rendering writes nothing");
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    mutate: refuse,
    set: refuse,
    unset: refuse,
  };
}

/**
 * The same broken vocabulary, but standing only in the composition layer, with no
 * user override under it — the shape an older cached bundle meets in a Host whose
 * schema has since dropped the literal.
 */
const BASE_ONLY: NamespaceSnapshot = {
  status: "ready",
  value: {
    configFile: ".dsh/doc-impact.yml",
    defaults: { mode: "require-attention" },
    changeDetection: { maxSnapshotFiles: 300 },
  },
  base: { defaults: { mode: "require-attention" } },
  user: {},
  writable: true,
  revision: 7,
  mode: "host",
};

/** A namespace the Host has not resolved: no document, so no field to show. */
const PENDING: NamespaceSnapshot = {
  status: "unavailable",
  value: {},
  base: {},
  user: {},
  writable: false,
  revision: 0,
  mode: "host",
};

/** The renderer the spec's kind prescribes. */
function rendererFor(spec: FieldSpec): unknown {
  switch (spec.kind) {
    case "bool":
      return BoolField;
    case "choice":
      return ChoiceField;
    case "number":
      return NumberField;
    case "text":
      return spec.multiline === true ? TextAreaField : TextField;
  }
}

/** Draws the card over one Host snapshot: its state and the elements created. */
function renderCard(host: NamespaceSnapshot = HOSTILE): {
  readonly snapshot: CardSnapshot;
  readonly elements: Rendered[];
} {
  const form = new SettingsForm(readOnlyForm(host));
  const snapshot = form.getSnapshot();
  tree.length = 0;
  ConfigCard({
    ...form.inject(),
    t: (key: string) => key,
    useDocImpactCard: <S>(select: (s: CardSnapshot) => S) => select(snapshot),
  });
  return { snapshot, elements: tree.slice() };
}

/** The one control that carries this field's state. */
function controlOf(
  elements: Rendered[],
  snapshot: CardSnapshot,
  field: string,
): Rendered {
  const own = elements.filter(
    (entry) => entry.props.state === snapshot.fields[field as never],
  );
  expect(own, `${field} controls`).toHaveLength(1);
  return own[0]!;
}

/** The `<select>` one picked control renders, with the options it offers. */
function selectOf(control: Rendered): {
  readonly value: unknown;
  readonly offered: unknown[];
} {
  tree.length = 0;
  (control.type as (props: Record<string, any>) => unknown)(control.props);
  const select = tree.filter((entry) => entry.type === "select")[0]!;
  // The options reach `createElement` as one array child, not as spread ones.
  return {
    value: select.props.value,
    offered: (select.children.flat() as Rendered[]).map(
      (option) => option.props.value,
    ),
  };
}

describe("doc-impact card render", () => {
  it("draws exactly one control per field the specs declare", () => {
    const { snapshot, elements } = renderCard();
    const controls = elements.filter((entry) =>
      Object.hasOwn(entry.props, "state"),
    );
    // A field added to the section and the specs but not to the card, or drawn
    // twice, lands here as a length that is not the spec count.
    expect(controls).toHaveLength(FIELDS.length);
    for (const spec of FIELDS) {
      const control = controlOf(controls, snapshot, spec.field);
      expect(control.type, `${spec.field} renderer`).toBe(rendererFor(spec));
    }
  });

  it("repeats a fallback only where it matches the spec", () => {
    const { snapshot, elements } = renderCard();
    // `card.ts` hands the picked fields their default a second time, by hand: the
    // renderer reaches for `props.fallback` where `state.value` is missing, which
    // the staged draft of a picked field never is. So the literal the operator
    // would see has to be the one the spec carries, and no drafted field may grow
    // a third copy of a default that nothing reads.
    for (const spec of FIELDS) {
      const control = controlOf(elements, snapshot, spec.field);
      if (spec.kind === "bool" || spec.kind === "choice") {
        expect(control.props.fallback, spec.field).toBe(spec.fallback);
      } else {
        expect(Object.hasOwn(control.props, "fallback"), spec.field).toBe(
          false,
        );
      }
    }
  });

  it("marks an override the operator can still reset", () => {
    const { snapshot } = renderCard();
    // Presence, not value, is what stands as an override: the vocabulary broke,
    // not the fact that the user layer holds the field.
    expect(snapshot.fields.mode.overridden).toBe(true);
    expect(snapshot.fields.onLimit.overridden).toBe(false);
  });

  it("selects an option the field really offers", () => {
    const { snapshot, elements } = renderCard();
    for (const spec of FIELDS) {
      if (spec.kind !== "choice") continue;
      const control = controlOf(elements, snapshot, spec.field);
      const select = selectOf(control);
      // `select.value` with no matching option reads back as `selectedIndex = -1`,
      // i.e. an empty box: the value shown has to be one of the options offered.
      expect(select.offered, spec.field).toContain(String(select.value));
      expect(select.value, spec.field).toBe(spec.fallback);
    }
  });

  it("reads a base-layer value outside the vocabulary as an unset field", () => {
    const { snapshot, elements } = renderCard(BASE_ONLY);
    // The known limit of the card: it cannot name a value its vocabulary does not
    // carry, so it shows the default and offers to write over it. Nothing here
    // claims the Host holds "remind" — the field simply has no override to show.
    expect(snapshot.fields.mode.value).toBe("remind");
    expect(
      snapshot.fields.mode.overridden,
      "no badge without an override",
    ).toBe(false);
    const select = selectOf(controlOf(elements, snapshot, "mode"));
    expect(select.offered).toContain(String(select.value));
  });

  it("answers a namespace the Host has not resolved with a sentence", () => {
    // The row page owns the frame, so this view cannot stay invisible the way a card
    // that draws its own shell can: an opened row would show nothing and say nothing.
    const form = new SettingsForm(readOnlyForm(PENDING));
    const snapshot = form.getSnapshot();
    expect(snapshot.available).toBe(false);
    tree.length = 0;
    const drawn = ConfigCard({
      ...form.inject(),
      t: (key: string) => key,
      useDocImpactCard: <S>(select: (s: CardSnapshot) => S) => select(snapshot),
    }) as unknown as Rendered;
    expect(tree).toHaveLength(1);
    expect(drawn.type).toBe("p");
    expect(drawn.props.role).toBe("status");
    expect(drawn.children.flat()).toContain("unavailable");
  });
});

/**
 * Draws one of the two views the way the seat does: the registered entry picks a
 * component, and that component renders. `client-bundle.test.ts` pins the same
 * dispatch on the built bundle; this pins it on the source, where an entry that
 * stopped forwarding the props its card needs shows up as a missing control rather
 * than as an assertion nobody made.
 */
/**
 * The entry is typed against the whole composed seat, and `PropsRuntime` folds in
 * the Host's global share — `usePanelInfo`, a hook only a running Host can hand
 * over. Every share this file is about is supplied in full and typed: the injected
 * face, the `t` seat, and the page's own `view` and `form`. What is dropped is the
 * Host's panel hook, which neither view of this entry reads.
 */
type EntryProps = Omit<RowEntryProps, "usePanelInfo">;

function renderView(
  view: "page" | "summary",
  host: NamespaceSnapshot = HOSTILE,
): {
  readonly snapshot: CardSnapshot;
  readonly elements: Rendered[];
  /** What the component the entry picked returned: an element for the page, text for the summary. */
  readonly drawn: unknown;
} {
  const form = new SettingsForm(readOnlyForm(host));
  const snapshot = form.getSnapshot();
  tree.length = 0;
  const seatProps: EntryProps = {
    ...form.inject(),
    t: (key: string) => key,
    useDocImpactCard: <S>(select: (s: CardSnapshot) => S) => select(snapshot),
    view: view,
    // What the page really spreads over the face: its own snapshot of this
    // namespace and its own write path. The card takes nothing from either; the
    // bundle test is where a card that started reading it would go red.
    form: { state: host, mutate: async () => false },
  };
  const element = RowConfigEntry(seatProps as RowEntryProps);
  const component = element.type as (props: never) => unknown;
  const drawn = component(element.props as never);
  return { snapshot, elements: tree.slice(), drawn };
}

describe("doc-impact seat entry", () => {
  it("forwards the seat's props to a body that still draws every field", () => {
    const { snapshot, elements, drawn } = renderView("page");
    // The row page supplies the frame, so the view is a plain body element: an
    // entry that grew a list or a shell of its own nests a second card inside the
    // page's one.
    expect((drawn as Rendered).type).toBe("div");
    expect((drawn as Rendered).props.className).toBe("ddi_body");
    const controls = elements.filter((entry) =>
      Object.hasOwn(entry.props, "state"),
    );
    expect(controls, "one control per spec, through the entry").toHaveLength(
      FIELDS.length,
    );
    for (const spec of FIELDS) {
      const control = controlOf(controls, snapshot, spec.field);
      expect(control.type, `${spec.field} renderer`).toBe(rendererFor(spec));
    }
  });

  it("mounts nothing behind the row's one-liner", () => {
    const { elements, drawn } = renderView("summary");
    // The entry is the only element created on this path: the page puts the reply
    // inside its own `<p>`, so a shell, a list, or a subscribed store here would be
    // a second live copy of the form in a line of heading text.
    expect(elements).toHaveLength(1);
    expect(elements[0]!.type).toBe(CardSummary);
    expect(drawn).toBe("cardDescription");
  });
});
