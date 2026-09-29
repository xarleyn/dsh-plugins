// What the card actually draws, field by field. `SPECS`, the schema and the
// section all agree by construction (`settings.test.ts` pins that), but nothing
// joined the spec list to the ten `createElement` calls in `card.ts`: a field
// could appear in the schema, in the section and in the specs and still never
// reach the screen, and a field could be drawn by a renderer its own kind cannot
// carry. These two are the pins for that, plus the one for a choice whose stored
// value is outside its vocabulary — the select then has no option to mark
// selected, which reads on screen as an empty box.
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

import { ConfigCard } from "../src/client/card.js";
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

/** Draws the card and returns the elements it created. */
function renderCard(snapshot: CardSnapshot): Rendered[] {
  const form = new SettingsForm(readOnlyForm(HOSTILE));
  const face = form.inject();
  tree.length = 0;
  ConfigCard({
    ...face,
    t: (key: string) => key,
    useDocImpactCard: (select: (s: CardSnapshot) => CardSnapshot) =>
      select(snapshot),
  });
  return tree.slice();
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

describe("doc-impact card render", () => {
  it("draws exactly one control per field the specs declare", () => {
    const snapshot = new SettingsForm(readOnlyForm(HOSTILE)).getSnapshot();
    const controls = renderCard(snapshot).filter((entry) =>
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

  it("marks an override the operator can still reset", () => {
    const snapshot = new SettingsForm(readOnlyForm(HOSTILE)).getSnapshot();
    // Presence, not value, is what stands as an override: the vocabulary broke,
    // not the fact that the user layer holds the field.
    expect(snapshot.fields.mode.overridden).toBe(true);
    expect(snapshot.fields.onLimit.overridden).toBe(false);
  });

  it("selects an option the field really offers", () => {
    const snapshot = new SettingsForm(readOnlyForm(HOSTILE)).getSnapshot();
    const elements = renderCard(snapshot);
    for (const spec of FIELDS) {
      if (spec.kind !== "choice") continue;
      const control = controlOf(elements, snapshot, spec.field);
      tree.length = 0;
      (control.type as (props: Record<string, any>) => unknown)(control.props);
      const select = tree.filter((entry) => entry.type === "select")[0]!;
      // The options reach `createElement` as one array child, not as spread ones.
      const offered = (select.children.flat() as Rendered[]).map(
        (option) => option.props.value,
      );
      // `select.value` with no matching option reads back as `selectedIndex = -1`,
      // i.e. an empty box: the value shown has to be one of the options offered.
      expect(offered, spec.field).toContain(String(select.props.value));
      expect(select.props.value, spec.field).toBe(spec.fallback);
    }
  });
});
