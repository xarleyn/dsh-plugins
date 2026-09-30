import { describe, expect, it } from "vitest";
import { createModuleLoaderStub } from "@yadsh/dsh-test-kit";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { join } from "node:path";

const CLIENT_BUNDLE_PATH = join(import.meta.dirname, "..", "lib", "client.js");

/**
 * The plugin row `cordis.patch.yml` declares. Its `name` is the bundle's package
 * name and its `id` is both the row id the keyed seat ends at and the settings
 * namespace the Host files this plugin's live Config under — so the card's seat key
 * and its form read are derived from this pair, never from a literal of their own.
 */
function patchRow(): { name: string; id: string } {
  const patch = readFileSync(
    join(import.meta.dirname, "..", "cordis.patch.yml"),
    "utf8",
  );
  const id = /^\s*-?\s*id:\s*"?([\w.-]+)"?/mu.exec(patch)?.[1];
  const name = /^\s*name:\s*"?([^"\n]+)"?/mu.exec(patch)?.[1];
  if (!id || !name) throw new Error(`cordis.patch.yml declares no plugin row`);
  return { name, id };
}

interface SlotEntry {
  options: {
    name: string;
    /** The keyed seat this entry occupies: `<package name>#<row id>`. */
    key?: string;
    locale?: string;
    inject?: () => unknown;
  };
  component: unknown;
}

interface LoadedBundle {
  id: string;
  factory: (requireFn: (name: string) => unknown) => {
    name: string;
    inject: string[];
    apply: (ctx: Record<string, unknown>) => void;
  };
}

function fakeReact() {
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
      type,
      props,
      children,
    }),
    useState: (initial: unknown) => [initial, () => undefined],
    useSyncExternalStore: () => undefined,
  };
}

interface FormState {
  status: "loading" | "ready" | "unavailable";
  value?: Record<string, unknown>;
  base?: Record<string, unknown>;
  user?: Record<string, unknown>;
  writable: boolean;
}

interface WrittenOp {
  op: "set" | "unset";
  path: string[];
  value?: unknown;
  revision: number;
}

function at(node: unknown, path: readonly string[]): unknown {
  let current = node;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Write one path into a copy of the document, creating the objects it passes. */
function through(
  source: Record<string, unknown> | undefined,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const root: Record<string, unknown> = { ...(source ?? {}) };
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = node[path[i]!];
    const copy: Record<string, unknown> = {
      ...(typeof next === "object" && next !== null ? next : undefined),
    };
    node[path[i]!] = copy;
    node = copy;
  }
  const last = path[path.length - 1]!;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return root;
}

/**
 * The host `ConfigForm` a card reaches through `ctx.configForms`: a synced
 * snapshot of one namespace document plus ordered, revision-fenced path
 * operations. The document keeps the nested profile shape (`defaults.mode`,
 * `safety.*`), so this stand is nested too — a flat one would keep passing while
 * every real write landed nowhere.
 */
function fakeForm(initial: FormState) {
  let state = initial;
  let revision = 0;
  const listeners = new Set<() => void>();
  const writes: WrittenOp[] = [];
  const emit = () => listeners.forEach((listener) => listener());
  return {
    writes,
    getSnapshot: () => ({ ...state, revision, mode: "host" as const }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async mutate(
      ops: readonly { op: "set" | "unset"; path: string[]; value?: unknown }[],
      expectedRevision?: number,
    ) {
      // The Host refuses a write whose fence it has already moved past.
      if (expectedRevision !== undefined && expectedRevision !== revision)
        return false;
      revision += 1;
      for (const op of ops) {
        writes.push({ ...op, revision });
        const value = op.op === "unset" ? undefined : op.value;
        state = {
          ...state,
          user: through(state.user, op.path, value),
          value: through(state.value, op.path, value),
        };
      }
      emit();
      return true;
    },
    /** Move the composition layer under the document, the way an entry config edit does. */
    setBase(path: readonly string[], value: unknown) {
      const base = through(state.base, path, value);
      const overridden = at(state.user, path) !== undefined;
      state = {
        ...state,
        base,
        value: overridden ? state.value : through(state.value, path, value),
      };
      emit();
    },
  };
}

function makeCtx(form: unknown) {
  const registered: SlotEntry[] = [];
  const slotInjections: string[] = [];
  const namespacesRead: string[] = [];
  const ctx = {
    registered,
    slotInjections,
    namespacesRead,
    // The client runtime exposes declared inject services as context
    // properties, so the stub mirrors that contract (the former ctx.get
    // indirection was a 0.1.1 leftover that left the card unregistered). The
    // keyed seat declares only its locale namespace and the page hands the entry
    // the translate function, so `register` is the sole locale method a seat needs.
    locale: {
      register: () => undefined,
    },
    configForms:
      form === undefined
        ? undefined
        : {
            get: (namespace: string) => {
              namespacesRead.push(namespace);
              return form;
            },
          },
    slots: {
      // The card bootstrap registers through a plain factory that returns the
      // register disposer (the shared host contract), not a generator.
      inject(slot: string, factory: () => () => unknown) {
        slotInjections.push(slot);
        factory();
      },
      register(options: SlotEntry["options"], component: unknown) {
        const entry = { options, component };
        registered.push(entry);
        return () => undefined;
      },
    },
  };
  return ctx;
}

async function loadBundle(): Promise<LoadedBundle> {
  const source = await readFile(CLIENT_BUNDLE_PATH, "utf8");
  const loader = createModuleLoaderStub();
  const sandbox = { window: loader.window };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "client.js" }).runInContext(sandbox);
  if (loader.registrations.length === 0)
    throw new Error("bundle never called ModuleLoader.load");
  return loader.registrations[0]! as LoadedBundle;
}

/** Where each card field stands inside the namespace document. */
const PATHS = {
  configFile: ["configFile"],
  debug: ["debug"],
  limitTemplate: ["limitTemplate"],
  maxSnapshotFiles: ["changeDetection", "maxSnapshotFiles"],
  mode: ["defaults", "mode"],
  reminderTemplate: ["reminderTemplate"],
} as const;

interface CardFace {
  hooks: { docImpactCard: { getSnapshot: () => Record<string, any> } };
  edit: (field: string, text: string) => void;
  choose: (field: string, value: unknown) => void;
  resetField: (field: string) => void;
  save: () => Promise<void>;
  discard: () => void;
}

function faceOf(ctx: ReturnType<typeof makeCtx>): CardFace {
  return ctx.registered[0]!.options.inject!() as CardFace;
}

/**
 * The seat's entry is a wrapper that picks the component for the view the page
 * asked for, so a test calls one level down: the wrapper hands back the element,
 * and rendering that element's component is what produces the view's own output.
 */
function renderEntry(
  entry: (props: Record<string, unknown>) => any,
  props: Record<string, unknown>,
): any {
  const element = entry(props);
  return typeof element?.type === "function"
    ? element.type(element.props)
    : element;
}

describe("client bundle", () => {
  it("loads as a ModuleLoader module and registers the card on the Plugins page", async () => {
    const bundle = await loadBundle();
    const row = patchRow();
    expect(bundle.id).toBe(row.name);

    const form = fakeForm({
      status: "ready",
      value: {},
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);

    expect(ctx.slotInjections).toEqual(["plugins.row.config"]);
    expect(ctx.registered).toHaveLength(1);
    expect(ctx.registered[0]!.options.name).toBe("plugins.row.config");
    // The keyed seat joins this bundle's package name to the row id its patch
    // declares, and the page shows the configure control only for a pair that
    // really exists in the inventory — so both halves are read from the patch here
    // rather than repeated as a literal, and a drift in the patch reddens the test
    // instead of silently losing the card.
    expect(ctx.registered[0]!.options.key).toBe(`${row.name}#${row.id}`);
    // The same row id is the namespace the form is read through: that pairing is how
    // a value saved before the move is the value this card reads after it.
    expect(ctx.namespacesRead).toEqual([row.id]);
    expect(ctx.registered[0]!.options.locale).toBe("dsh-doc-impact");
    // The page titles the row from the plugin's own display name, so the seat
    // carries none of the tab's chrome.
    const seat = ctx.registered[0]!.options as Record<string, unknown>;
    expect(seat["label"]).toBeUndefined();
    expect(seat["order"]).toBeUndefined();
    expect(seat["id"]).toBeUndefined();
    expect(ctx.registered[0]!.component).toBeTypeOf("function");
  });

  it("mounts the form inside the shared shell for the page view the seat hands", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: { configFile: ".dsh/doc-impact.yml" },
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);

    const entry = ctx.registered[0]!.component as (
      props: Record<string, unknown>,
    ) => any;
    // The page's configuration section asks this seat for `{ view: 'page', form }`
    // (PluginManagerPage.tsx:495), and that view is the live form: the shell, then
    // the fields the snapshot projects, read through this bundle's row namespace.
    const face = faceOf(ctx) as unknown as Record<string, any>;
    const reads: string[] = [];
    const page = renderEntry(entry, {
      view: "page",
      t: (key: string) => key,
      useDocImpactCard: () => {
        reads.push("settings");
        return face.hooks.docImpactCard.getSnapshot();
      },
    });

    expect(reads).toEqual(["settings"]);
    expect(page.type).toBe("ul");
    expect(page.props.className).toBe("ddi_list");
    const shell = page.children[0];
    expect(shell.props.title).toBe("cardTitle");
    expect(shell.props.description).toBe("cardDescription");
    // Nothing is staged, so the header carries no unsaved badge.
    expect(shell.props.badge).toBeUndefined();
  });

  it("answers the summary view with the one-liner as text, touching no settings state", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {},
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);

    const entry = ctx.registered[0]!.component as (
      props: Record<string, unknown>,
    ) => any;
    const face = faceOf(ctx) as unknown as Record<string, any>;
    const reads: string[] = [];
    // The row's page takes its heading from this seat's `view: 'summary'` whenever
    // the patch declares no description — and `cordis.patch.yml` declares none, so
    // this view is what an operator reads first. The page puts it inside its own
    // `<p>`, so it owes the page text: no shell, no list, no second form mount.
    const summary = renderEntry(entry, {
      view: "summary",
      t: (key: string) => key,
      useDocImpactCard: () => {
        reads.push("settings");
        return face.hooks.docImpactCard.getSnapshot();
      },
    });

    expect(reads).toEqual([]);
    expect(typeof summary).toBe("string");
    expect(summary).toBe("cardDescription");
  });

  it("falls back to the dictionary's own text when the seat hands no translate function", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {},
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);

    const entry = ctx.registered[0]!.component as (
      props: Record<string, unknown>,
    ) => any;
    const face = faceOf(ctx) as unknown as Record<string, any>;
    const page = renderEntry(entry, {
      view: "page",
      useDocImpactCard: () => face.hooks.docImpactCard.getSnapshot(),
    });
    const summary = renderEntry(entry, {
      view: "summary",
      useDocImpactCard: () => face.hooks.docImpactCard.getSnapshot(),
    });

    // An older or headless profile may hand the seat no `t`; both views then speak
    // the Russian text this bundle registered, rather than the key or a thrown call.
    expect(page.children[0].props.title).toBeTypeOf("string");
    expect(page.children[0].props.title).not.toBe("cardTitle");
    expect(page.children[0].props.title.length).toBeGreaterThan(0);
    expect(summary).toBe(page.children[0].props.description);
  });

  it("skips registration when the configForms service is absent", async () => {
    const bundle = await loadBundle();
    const ctx = makeCtx(undefined);
    bundle.factory(fakeReact).apply(ctx);
    expect(ctx.registered).toHaveLength(0);
  });

  it("stages edits without writing; save is dirty-gated and commits field-granular writes", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {
        configFile: ".dsh/doc-impact.yml",
        defaults: { mode: "remind" },
      },
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);

    const face = faceOf(ctx);
    const snapshot = () => face.hooks.docImpactCard.getSnapshot();

    // Clean state: save must stay disabled.
    expect(snapshot().available).toBe(true);
    expect(snapshot().dirty).toBe(false);

    // Editing stages locally: dirty, overridden preview, nothing on the wire.
    face.edit("configFile", ".dsh/other.yml");
    expect(snapshot().dirty).toBe(true);
    expect(snapshot().fields.configFile.overridden).toBe(true);
    expect(form.writes).toHaveLength(0);

    // Discard drops the draft.
    face.discard();
    expect(snapshot().dirty).toBe(false);

    // Value staging through the select.
    face.choose("mode", "require-review");
    expect(snapshot().dirty).toBe(true);
    expect(snapshot().fields.mode.value).toBe("require-review");

    await face.save();
    // The write carries the fence read at the moment of writing, and addresses
    // the field where the entry config really keeps it.
    expect(form.writes).toEqual([
      { op: "set", path: PATHS.mode, value: "require-review", revision: 1 },
    ]);
    expect(snapshot().dirty).toBe(false);
  });

  it("reset only plans a write when the field is actually overridden", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: { defaults: { mode: "require-resolution" } },
      base: { defaults: { mode: "remind" } },
      user: { defaults: { mode: "require-resolution" } },
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);

    expect(face.hooks.docImpactCard.getSnapshot().fields.mode.overridden).toBe(
      true,
    );
    face.resetField("mode");
    const snapshot = face.hooks.docImpactCard.getSnapshot();
    expect(snapshot.dirty).toBe(true);
    expect(snapshot.fields.mode.overridden).toBe(false);
    expect(snapshot.fields.mode.value).toBe("remind"); // composition base preview

    await face.save();
    expect(form.writes).toEqual([
      { op: "unset", path: PATHS.mode, revision: 1 },
    ]);
    expect(face.hooks.docImpactCard.getSnapshot().dirty).toBe(false);
  });

  it("resets every field kind by dropping the user layer, not by copying the base into it", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {
        configFile: ".dsh/from-user.yml",
        defaults: { mode: "require-review" },
        changeDetection: { maxSnapshotFiles: 300 },
        debug: true,
        reminderTemplate: "Custom: {body}",
      },
      base: {
        configFile: ".dsh/from-base.yml",
        defaults: { mode: "remind" },
        changeDetection: { maxSnapshotFiles: 100 },
        debug: false,
      },
      user: {
        configFile: ".dsh/from-user.yml",
        defaults: { mode: "require-review" },
        changeDetection: { maxSnapshotFiles: 300 },
        debug: true,
        reminderTemplate: "Custom: {body}",
      },
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);
    const snapshot = () => face.hooks.docImpactCard.getSnapshot();

    for (const field of [
      "configFile", // text
      "mode", // choice
      "maxSnapshotFiles", // number
      "debug", // bool
      "reminderTemplate", // multiline text
    ]) {
      face.resetField(field);
      const state = snapshot().fields[field];
      expect(state.overridden, field).toBe(false);
      expect(state.invalid, field).toBe(false);
    }
    // The draft previews the base it would fall back to, without claiming an override.
    expect(snapshot().fields.maxSnapshotFiles.text).toBe("100");
    expect(snapshot().fields.configFile.text).toBe(".dsh/from-base.yml");

    await face.save();
    expect(form.writes.map((write) => write.path.join(".")).sort()).toEqual(
      [
        "configFile",
        "debug",
        "changeDetection.maxSnapshotFiles",
        "defaults.mode",
        "reminderTemplate",
      ].sort(),
    );
    expect(snapshot().dirty).toBe(false);

    // A reset field keeps following the base afterwards: moving it to 200 is
    // visible, which a base copied into the user layer would have frozen.
    form.setBase(PATHS.maxSnapshotFiles, 200);
    expect(snapshot().fields.maxSnapshotFiles.value).toBe(200);
    expect(snapshot().fields.maxSnapshotFiles.overridden).toBe(false);
  });

  it("blocks saving an invalid number and reports the invalid draft", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {},
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);

    face.edit("maxReminderRounds", "not-a-number");
    const snapshot = face.hooks.docImpactCard.getSnapshot();
    expect(snapshot.invalid).toBe(true);
    expect(snapshot.fields.maxReminderRounds.invalid).toBe(true);

    await face.save();
    expect(form.writes).toHaveLength(0);
    expect(snapshot.dirty).toBe(true); // drafts kept for correction
  });

  it("gates the reminder template on its payload placeholder and resets by unset", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: { reminderTemplate: "Custom: {body}" },
      base: {},
      user: { reminderTemplate: "Custom: {body}" },
      writable: true,
    });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);
    const snapshot = () => face.hooks.docImpactCard.getSnapshot();

    // An unset multiline field previews the default template for editing.
    face.edit("limitTemplate", "Limit after {rounds}:\n{impacts}");
    await face.save();
    expect(form.writes).toEqual([
      {
        op: "set",
        path: PATHS.limitTemplate,
        value: "Limit after {rounds}:\n{impacts}",
        revision: 1,
      },
    ]);

    // Dropping the {body} placeholder blocks the save.
    face.edit("reminderTemplate", "no payload");
    expect(snapshot().invalid).toBe(true);
    expect(snapshot().fields.reminderTemplate.invalid).toBe(true);
    await face.save();
    expect(form.writes).toHaveLength(1); // nothing new landed

    // Reset stages a clear: the user layer drops back to the default text.
    face.discard();
    face.resetField("reminderTemplate");
    expect(snapshot().fields.reminderTemplate.invalid).toBe(false);
    await face.save();
    expect(form.writes).toHaveLength(2);
    expect(form.writes[1]).toEqual({
      op: "unset",
      path: PATHS.reminderTemplate,
      revision: 2,
    });
  });

  it("renders nothing while the namespace is unavailable", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({ status: "loading", writable: false });
    const ctx = makeCtx(form);
    bundle.factory(fakeReact).apply(ctx);
    const face = faceOf(ctx);
    expect(face.hooks.docImpactCard.getSnapshot().available).toBe(false);
  });
});
