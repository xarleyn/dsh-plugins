import { readFileSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import * as clientModule from "../src/client/index.js";
import { WEB_FETCH_AUTH_SETTINGS_NAMESPACE } from "../src/types.js";

const { apply } = clientModule;

/**
 * The seam between this card and the Host's Plugins page.
 *
 * Two of the move's load-bearing facts are invisible to the compiler, and each
 * fails by making the card quietly disappear rather than by throwing:
 *
 * 1. The seat is keyed `<package name>#<row id>`, and the page looks that key up
 *    in the inventory built from this bundle's `cordis.patch.yml`. Restating the
 *    key as a literal here would let a renamed row or a renamed package unseat
 *    the card while every gate stayed green — so the key is derived from the two
 *    files that define it, and the row id is compared against the settings
 *    namespace the card reads and writes under, because one string is both.
 * 2. The page spreads its own owner props over the injected face, and two of
 *    them are `view` and `form`. A face occupying either name is overwritten
 *    without a trace, so the full `ConfigForm` crosses as `settingsForm` and
 *    neither owner name is claimed.
 *
 * The same entry is seated twice — once as the row's description line, once as
 * its configuration body — which is what the last two cases pin.
 */

/** The package this bundle publishes under, read from its own manifest. */
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string };

/**
 * The `id` of this bundle's single patch row, read from the patch the Host
 * inventories. The `key` the page matches on is built from it, so the test takes
 * it from the same source rather than trusting a copy.
 */
function patchRowId(): string {
  const patch = readFileSync(
    new URL("../cordis.patch.yml", import.meta.url),
    "utf8",
  );
  const ids = [...patch.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gmu)].map(
    (match) => match[1] as string,
  );
  expect(ids, "the patch must declare exactly one row").toHaveLength(1);
  return ids[0] as string;
}

/** The card's own source, for the one fact it must state in two seats. */
const clientSource = readFileSync(
  new URL("../src/client/index.tsx", import.meta.url),
  "utf8",
);

/** The Remote namespace the mounted contribution answers on. */
const remoteStub = {
  status: () => Promise.resolve({ ok: true, value: {} }),
  testRule: () => Promise.resolve({ ok: true, value: {} }),
  diagnose: () => Promise.resolve({ ok: true, value: {} }),
};

const credentialsStub = {
  list: () => Promise.resolve({ ok: true, value: [] }),
};

/** The Host form the card binds; identity is all this file asserts about it. */
const formStub = {
  get: () => undefined,
  getSnapshot: () => ({ value: undefined, status: "ready", writable: true }),
  set: () => Promise.resolve(true),
  unset: () => Promise.resolve(true),
  mutate: () => Promise.resolve(true),
  subscribe: () => () => undefined,
};

interface Seat {
  readonly name: string;
  readonly key: string | undefined;
  readonly face: Record<string, unknown>;
  readonly component: (props: Record<string, unknown>) => unknown;
}

/** Drive `apply()` against a bare context and keep the seat it registered. */
async function registeredSeat(): Promise<Seat> {
  const seats: Seat[] = [];
  const ctx = new Context();
  /*
   * The Remote namespace is exposed both as a property of the `remote` face and
   * as a service key of its own: the code under test reads the property, while
   * `ctx.inject(["remote.webFetchAuth"])` resolves the key. A bare context
   * stands in for the browser runner, which resolves the key through the
   * gateway's isolate map instead.
   */
  ctx.provide("remote", {
    webFetchAuth: remoteStub,
    credentials: credentialsStub,
    $mount: () => Promise.resolve(() => Promise.resolve()),
  });
  ctx.provide("remote.webFetchAuth", remoteStub);
  ctx.provide("configForms", { get: () => formStub });
  ctx.provide("slots", {
    inject: (_key: string, callback: () => (() => void) | void) => {
      const dispose = callback();
      return () => {
        if (typeof dispose === "function") dispose();
      };
    },
    register: (
      options: {
        name: string;
        key?: string;
        inject?: () => Record<string, unknown>;
      },
      component: unknown,
    ) => {
      seats.push({
        name: options.name,
        key: options.key,
        face: options.inject?.() ?? {},
        component: component as (props: Record<string, unknown>) => unknown,
      });
      return () => undefined;
    },
  });

  await apply(ctx);
  const [seat] = seats;
  if (seat === undefined) throw new Error("apply() registered no seat");
  return seat;
}

describe("plugins row configuration seat", () => {
  it("keys the seat by this package and its own patch row", async () => {
    const seat = await registeredSeat();
    expect(seat.name).toBe("plugins.row.config");
    expect(seat.key).toBe(`${packageJson.name}#${patchRowId()}`);
  });

  it("takes the row id as the settings namespace, so a saved value survives the move", async () => {
    const seat = await registeredSeat();
    const [packageName, rowId] = (seat.key ?? "").split("#");
    expect(rowId).toBe(WEB_FETCH_AUTH_SETTINGS_NAMESPACE);
    expect(packageName).toBe(packageJson.name);
  });

  it("frees both owner prop names and carries the form under a third", async () => {
    const seat = await registeredSeat();
    expect(seat.face).not.toHaveProperty("form");
    expect(seat.face).not.toHaveProperty("view");
    expect(seat.face.settingsForm).toBe(formStub);
  });

  it("answers the row's summary seat with one line of text and no card", async () => {
    const seat = await registeredSeat();
    const summary = seat.component({ ...seat.face, view: "summary" });

    // The page drops this into a paragraph of its own; markup here would nest a
    // card inside a sentence, and the card's hooks would run for a line of text.
    expect(typeof summary).toBe("string");
    expect(summary).not.toMatch(/</u);
    expect((summary as string).trim()).not.toBe("");
  });

  it("mounts the card only for the page seat, over the same form", async () => {
    const seat = await registeredSeat();
    const page = seat.component({ ...seat.face, view: "page" }) as {
      type: unknown;
      props: Record<string, unknown>;
    };

    expect(typeof page.type).toBe("function");
    expect(page.props.settingsForm).toBe(formStub);
  });

  it("states the row's one-liner once, for both seats", () => {
    // The summary answer and the shell's description are the same sentence; a
    // second literal is how the two start disagreeing.
    expect(clientSource).toMatch(/description=\{WEB_FETCH_AUTH_ROW_SUMMARY\}/u);
    expect(clientSource).toMatch(
      /if \(view === "summary"\) return WEB_FETCH_AUTH_ROW_SUMMARY;/u,
    );
  });
});
