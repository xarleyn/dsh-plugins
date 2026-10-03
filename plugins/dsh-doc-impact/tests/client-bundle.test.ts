// The seat this bundle's client takes: where the card is registered, what the
// registration carries, and what the two views the Plugins row asks for render. The
// stubs are shared with `client-form-writes.test.ts` through
// `helpers/client-seat.ts`, which is also what keeps either file inside the
// repository's test-file budget.
import { describe, expect, it } from "vitest";
import { readPatchRow } from "../scripts/patch-row.mjs";
import {
  faceOf,
  fakeForm,
  fakeReact,
  loadBundle,
  makeCtx,
  PATCH_PATH,
  renderEntry,
  PATHS,
} from "./helpers/client-seat.js";

describe("client bundle", () => {
  it("loads as a ModuleLoader module and seats the card on its own row", async () => {
    const bundle = await loadBundle();
    // Both halves of the seat key are read from the patch rather than repeated as
    // a literal here: the page hands a row its configure control only for a pair
    // its roster really carries, so a row id that moves has to redden this file
    // instead of quietly taking the card away from the operator.
    const row = await readPatchRow(PATCH_PATH);
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
    // The renderer spreads the owner props after the injected face, so a face
    // member named `form` would be shadowed by the page's narrower
    // `ConfigPageForm` and the card would silently stop seeing its own. The face
    // therefore carries its form under no name the seat also uses — the same
    // collision `dsh-model-safety-gate` avoids by naming its member `settingsForm`.
    const face = ctx.registered[0]!.options.inject!() as Record<
      string,
      unknown
    >;
    expect("form" in face).toBe(false);
    expect(ctx.registered[0]!.component).toBeTypeOf("function");
  });

  it("mounts the settings body for the page view, with no frame of ours", async () => {
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
    // (PluginManagerPage.tsx:495), and that view is the live form: the body the page
    // mounts inside the card it drew, then the fields the snapshot projects, read
    // through this bundle's row namespace.
    const page = renderEntry(entry, {
      view: "page",
      t: (key: string) => key,
      useDocImpactCard: () => {
        reads.push("settings");
        return face.hooks.docImpactCard.getSnapshot();
      },
    });

    expect(reads).toEqual(["settings"]);
    expect(page.type).toBe("div");
    expect(page.props.className).toBe("ddi_body");
    // The frame, the heading and the expand control are the page's. A list root, or a
    // child that carries a title or an `aria-expanded`, is our own card nested inside
    // the Host's — the second frame the row contract exists to prevent.
    const mounted = page.children.filter(Boolean);
    expect(
      mounted.some((child: any) => child.type === "ul" || child.type === "li"),
      "no list root around the body",
    ).toBe(false);
    expect(
      mounted.some(
        (child: any) =>
          child.props?.title !== undefined ||
          child.props?.["aria-expanded"] !== undefined,
      ),
      "no heading or toggle of ours",
    ).toBe(false);
    // Nothing is staged, so the write controls carry no unsaved marker.
    expect(JSON.stringify(mounted)).not.toContain("unsaved");
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

    // The view the card draws is the namespace it resolved, not the prop: had it read
    // the page's `state`, the poisoned `unavailable` would have replaced this body
    // with the sentence an unresolved namespace answers with.
    expect(page.type).toBe("div");
    expect(page.props.className).toBe("ddi_body");
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

  it("still seats the card when the namespace never reaches the describe mirror", async () => {
    const bundle = await loadBundle();
    // The state AGENTS.md names for a card seated on the Plugins panel: a browser
    // that keeps answering while the settings directory is intentionally
    // unavailable. The Host's mirror calls that reply terminal
    // (`settings-mirror.d.ts`), so a seat claimed from inside `whileServed` would
    // take the row's configure control away here — hiding the card where the rule
    // says to disable its write controls. `get` still answers a form for the name,
    // so the seat is claimed without the directory and the body carries the state.
    const ctx = makeCtx(
      fakeForm({
        status: "unavailable",
        value: {},
        base: {},
        user: {},
        writable: false,
      }),
      { served: false },
    );
    bundle.factory(fakeReact).apply(ctx);
    expect(ctx.servedRequests).toEqual([]);
    expect(ctx.slotInjections).toEqual(["plugins.row.config"]);
    expect(ctx.registered).toHaveLength(1);

    const entry = ctx.registered[0]!.component as (
      props: Record<string, unknown>,
    ) => any;
    const face = faceOf(ctx) as unknown as Record<string, any>;
    const body = renderEntry(entry, {
      view: "page",
      t: (key: string) => key,
      useDocImpactCard: () => face.hooks.docImpactCard.getSnapshot(),
    });
    // The row opened, so the section says why it holds no fields instead of
    // standing empty.
    expect(body.type).toBe("p");
    expect(body.props.role).toBe("status");
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
});
