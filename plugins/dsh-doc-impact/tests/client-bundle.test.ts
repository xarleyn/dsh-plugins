import { describe, expect, it } from "vitest";
import { createModuleLoaderStub } from "@yadsh/dsh-test-kit";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { join } from "node:path";

const CLIENT_BUNDLE_PATH = join(import.meta.dirname, "..", "lib", "client.js");

interface SlotEntry {
  options: {
    name: string;
    key?: string;
    locale?: string;
    inject?: () => unknown;
  };
  component: unknown;
}

/**
 * The row this bundle's patch declares. The keyed seat is dispatched on
 * `<package name>#<row id>` and the page offers the configure control only for a
 * pair its inventory really carries, so both halves are read from the patch here
 * rather than repeated as a literal — a row id that moves reddens this file
 * instead of quietly taking the card away from the operator.
 */
async function patchRow(): Promise<{ name: string; id: string }> {
  const patch = await readFile(
    join(import.meta.dirname, "..", "cordis.patch.yml"),
    "utf8",
  );
  const id = /^\s*-?\s*id:\s*"?([\w.-]+)"?/mu.exec(patch)?.[1];
  const name = /^\s*name:\s*"?([^"\n]+)"?/mu.exec(patch)?.[1];
  if (!id || !name) throw new Error("cordis.patch.yml declares no plugin row");
  return { name, id };
}

interface LoadedBundle {
  id: string;
  factory: (requireFn: (name: string) => unknown) => {
    name: string;
    inject: string[];
    apply: (ctx: Record<string, unknown>) => () => void;
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
    /** How many listeners the card still holds on this controller. */
    get listenerCount(): number {
      return listeners.size;
    },
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
    /**
     * The Host's form answers these as well. The card only ever writes
     * field-granular *paths* through `mutate`, because the namespace document
     * keeps its nested shape (`defaults.mode`), so a call reaching here means the
     * card stopped addressing that shape — which is a bug, not a mode of writing.
     */
    set: async () => {
      throw new Error("the card writes paths through mutate");
    },
    unset: async () => {
      throw new Error("the card writes paths through mutate");
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

function makeCtx(form: unknown, options: { served?: boolean } = {}) {
  const registered: SlotEntry[] = [];
  const slotInjections: string[] = [];
  const servedRequests: string[][] = [];
  const namespacesRead: string[] = [];
  const served = options.served !== false;
  const ctx = {
    registered,
    slotInjections,
    servedRequests,
    namespacesRead,
    // The client runtime exposes declared inject services as context
    // properties, so the stub mirrors that contract (the former ctx.get
    // indirection was a 0.1.1 leftover that left the card unregistered).
    locale: {
      register: () => undefined,
    },
    // The shape of the real Host service: `get` always answers a controller,
    // even for a name the profile does not carry, and whether the namespace is
    // served at all is what `whileServed` answers.
    configForms:
      form === undefined
        ? undefined
        : {
            get: (namespace: string) => {
              namespacesRead.push(namespace);
              return form;
            },
            whileServed(
              namespaces: readonly string[],
              register: (servedNamespaces: ReadonlySet<string>) => () => void,
            ) {
              servedRequests.push([...namespaces]);
              if (!served) return () => undefined;
              const remove = register(new Set(namespaces));
              let ended = false;
              // What the Host's own declaration promises: this disposer ends the
              // watch *and* drops the registration that is live.
              return () => {
                if (ended) return;
                ended = true;
                remove();
              };
            },
          },
    slots: {
      // The card bootstrap registers through a plain factory that returns the
      // register disposer (the shared host contract), not a generator.
      inject(slot: string, factory: () => () => unknown) {
        slotInjections.push(slot);
        const remove = factory();
        return () => {
          remove();
        };
      },
      register(options: SlotEntry["options"], component: unknown) {
        const entry = { options, component };
        registered.push(entry);
        return () => {
          const at = registered.indexOf(entry);
          if (at >= 0) registered.splice(at, 1);
        };
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
 * The seat's entry picks the component for the view the page asked for, so a test
 * renders one level down: the entry hands back the element, and rendering that
 * element's own component is what produces the view's output.
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
  it("loads as a ModuleLoader module and seats the card on its own row", async () => {
    const bundle = await loadBundle();
    const row = await patchRow();
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
    // The seat is claimed only for a namespace the card reads, asked for by name.
    expect(ctx.servedRequests).toEqual([[row.id]]);
    expect(ctx.registered).toHaveLength(1);
    expect(ctx.registered[0]!.options.name).toBe("plugins.row.config");
    // Both halves of the key come from the patch: the package name the row is
    // inventoried under and the row id, which is the same string the form is read
    // through — so a value saved while this card sat on the old tab is the value
    // this seat reads back, and a patch that moves the row reddens the key here.
    expect(ctx.registered[0]!.options.key).toBe(`${row.name}#${row.id}`);
    expect(ctx.namespacesRead).toEqual([row.id]);
    expect(ctx.registered[0]!.options.locale).toBe("dsh-doc-impact");
    // A keyed seat carries a `key` and nothing else of the list seats' chrome
    // (`id`/`order`/`label`): the page titles and orders the row itself, so an
    // entry seated here has no label to hand and no place to stand in a queue.
    const seat = ctx.registered[0]!.options as Record<string, unknown>;
    expect(seat["id"]).toBeUndefined();
    expect(seat["order"]).toBeUndefined();
    expect(seat["label"]).toBeUndefined();
    expect(ctx.registered[0]!.component).toBeTypeOf("function");
  });

  it("mounts the card in the shared shell for the page view", async () => {
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
    const face = faceOf(ctx) as unknown as Record<string, any>;
    const reads: string[] = [];
    // The configuration section asks this seat for `{ view: 'page', form }`
    // (PluginManagerPage.tsx:495), and that view is the live form: the shell, then
    // the fields the snapshot projects, read through this bundle's row namespace.
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

  it("reads and fences the document through its own form, never the page's", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: { defaults: { mode: "remind" } },
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
    // The page spreads its own `ConfigPageForm` over the injected face: `{ state,
    // mutate }`, whose `state` is the single snapshot it took while rendering
    // (`formFor` in `PluginManagerPage`). This card follows writes it did not make,
    // so it must neither read values out of that prop nor send a write through it.
    // The stand is poisoned on both halves: a card that started taking the page's
    // `state` would render an unavailable namespace, and one that wrote through the
    // page's `mutate` would land here instead of on the resolved controller.
    const pageForm = {
      state: {
        status: "unavailable",
        value: {},
        base: {},
        user: {},
        writable: false,
        revision: 99,
        mode: "host",
      },
      mutate: async () => {
        throw new Error("the card must not write through the page's form");
      },
    };
    const page = renderEntry(entry, {
      view: "page",
      form: pageForm,
      t: (key: string) => key,
      useDocImpactCard: () => face.hooks.docImpactCard.getSnapshot(),
    });

    // The view the card draws is the namespace it resolved, not the prop.
    expect(page.type).toBe("ul");
    expect(page.children[0].props.title).toBe("cardTitle");
    expect(face.hooks.docImpactCard.getSnapshot().available).toBe(true);

    face.choose("debug", true);
    await face.save();
    expect(form.writes).toEqual([
      { op: "set", path: PATHS.debug, value: true, revision: 1 },
    ]);
  });

  it("answers the summary view with the one-liner as text, reading no settings state", async () => {
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
    // The row's heading line comes from `{ view: 'summary' }` (the same page at
    // :491) whenever the patch declares no description of its own — and
    // `cordis.patch.yml` declares none, so this is what an operator reads first.
    // The page puts the entry inside its own `<p>`, so it owes the page text: no
    // shell, no list, and no second copy of the form subscribed in a heading.
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

  it("skips registration when the configForms service is absent", async () => {
    const bundle = await loadBundle();
    const ctx = makeCtx(undefined);
    bundle.factory(fakeReact).apply(ctx);
    expect(ctx.slotInjections).toEqual([]);
    expect(ctx.registered).toHaveLength(0);
  });

  it("claims no seat while the host does not serve the namespace", async () => {
    const bundle = await loadBundle();
    // The Host answers `get` with a controller for any name, served or not; an
    // unserved namespace is told by `whileServed` alone. A stand where `get`
    // answers nothing would pin a reply the Host never sends, and could not go
    // red on the regression it claims to guard — the configure control comes from
    // the slot injection, so it is the injection that must not happen.
    const ctx = makeCtx(
      fakeForm({
        status: "ready",
        value: {},
        base: {},
        user: {},
        writable: true,
      }),
      { served: false },
    );
    bundle.factory(fakeReact).apply(ctx);
    expect(ctx.servedRequests).toEqual([["dsh-doc-impact"]]);
    expect(ctx.slotInjections).toEqual([]);
    expect(ctx.registered).toHaveLength(0);
  });

  it("rolls back what apply did once the entry is disposed", async () => {
    const bundle = await loadBundle();
    const form = fakeForm({
      status: "ready",
      value: {},
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(form);
    const dispose = bundle.factory(fakeReact).apply(ctx);
    expect(ctx.registered).toHaveLength(1);
    expect(form.listenerCount).toBe(1);

    dispose();
    // The seat goes with the watch that registered it, and the listener goes with
    // the card: `configForms.get` hands out one cached controller per namespace,
    // so a listener left behind would keep a discarded card alive on every write
    // the operator makes after a reload.
    expect(ctx.registered).toEqual([]);
    expect(form.listenerCount).toBe(0);

    // Teardown is idempotent — a second call must not fall over an ended watch.
    dispose();
    expect(ctx.registered).toEqual([]);
    expect(form.listenerCount).toBe(0);
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

  it("names a field the card does not edit, the way the built bundle has to", async () => {
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

    // The field name is only checked by the type in the source, and the bundle
    // carries no types: the guard has to survive the build, otherwise a name the
    // card does not edit surfaces as a `TypeError` on the snapshot read.
    // The inherited keys matter as much as the unknown one — the specs are a
    // plain object literal, so `SPECS["toString"]` answers the native function,
    // whose `path` is undefined, and the same `TypeError` comes back through it.
    for (const name of [
      "reminders",
      "toString",
      "constructor",
      "prototype",
      "__proto__",
      "hasOwnProperty",
    ]) {
      face.resetField(name);
      expect(() => face.hooks.docImpactCard.getSnapshot(), name).toThrow(
        `doc-impact card has no field ${name}`,
      );
      face.discard();
    }
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
