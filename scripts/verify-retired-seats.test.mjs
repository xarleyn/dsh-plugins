import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  inspectSeatSources,
  verifyRetiredSeats,
} from "./verify-retired-seats.mjs";
import { verifyPublishablePlugins } from "./verify-package-hygiene.mjs";

const inspect = (source) =>
  inspectSeatSources(
    new Map([["/workspace/plugins/demo/src/client.tsx", source]]),
  );
const bans = (source) =>
  inspect(source).findings.filter((entry) => entry.rule === "retired-seat");

test("retired seats are read per registration, including templates and aliases", () => {
  for (const seat of [
    "settings.plugin.item",
    "settings.plugins.tab",
    "plugins.item",
  ]) {
    assert.equal(
      bans(`ctx.slots.register({ name: \`${seat}\` }, Card);`).length,
      1,
    );
    assert.equal(
      bans(`const name = "${seat}"; ctx.slots.register({ name }, Card);`)
        .length,
      1,
    );
    assert.equal(
      bans(
        `const seats = ctx.slots; const mount = seats.register; mount({ name: "${seat}" }, Card);`,
      ).length,
      1,
    );
    assert.equal(bans(`ctx.slots.inject("${seat}", () => Card);`).length, 1);
  }
  assert.equal(
    bans(
      'ctx.slots.register({name: "plugins.row.config"}, Body); ctx.slots.register({name: "settings.plugins.tab"}, Card);',
    ).length,
    1,
  );
});

test("JSX apostrophes, regular expressions, comments and prose are not registrations", () => {
  const result = inspect(`
    // ctx.slots.register({ name: "settings.plugins.tab" }, Card);
    const pattern = /settings.plugins.tab/;
    const help = "ctx.slots.register({ name: 'settings.plugins.tab' }, Card)";
    const view = <p>Don't add a settings.plugins.tab registration.</p>;
    ctx.slots.register({ name: "plugins.row.config" }, Body);
  `);
  assert.deepEqual(result.findings, []);
});

test("static imported constants and options resolve without executing the module", () => {
  const sources = new Map([
    [
      "/workspace/packages/demo/src/client/seat.ts",
      'throw new Error("This module must never execute"); export const SLOT = "settings.plugins.tab";',
    ],
    [
      "/workspace/packages/demo/src/client/index.tsx",
      'import { SLOT as name } from "./seat.js"; const options = { name }; ctx.slots.register(options, Card);',
    ],
  ]);
  const result = inspectSeatSources(sources);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, "retired-seat");
});

test("workspace exports and re-exported namespace constants resolve statically", () => {
  const sources = new Map([
    [
      "/workspace/packages/kit/src/client/index.ts",
      'export { TAB as SLOT } from "./contract.js";',
    ],
    [
      "/workspace/packages/kit/src/client/contract.ts",
      "export const TAB = `settings.plugins.tab`;",
    ],
    [
      "/workspace/plugins/demo/src/client.tsx",
      'import { SLOT } from "@yadsh/kit/client"; import * as kit from "@yadsh/kit/client"; ctx.slots.register({name: SLOT}, Card); ctx.slots.register({name: kit.SLOT}, Card);',
    ],
  ]);
  const result = inspectSeatSources(sources, {
    workspacePackages: [
      {
        name: "@yadsh/kit",
        directory: "/workspace/packages/kit",
        exports: { "./client": { default: "./lib/client/index.js" } },
      },
    ],
  });
  assert.equal(
    result.findings.filter((finding) => finding.rule === "retired-seat").length,
    2,
  );
  assert.equal(result.dynamic, 0);
});

test("helper calls include renamed and namespace imports and spread defaults", () => {
  assert.equal(
    bans(
      'import { registerSettingsCard as mount } from "@yadsh/dsh-plugin-kit/client"; const defaults = { slotName: `settings.plugins.tab` }; mount(ctx, { ...defaults, component: Card });',
    ).length,
    1,
  );
  assert.equal(
    bans(
      'import * as kit from "@yadsh/dsh-plugin-kit/client"; kit.registerSettingsSlot(ctx, { slotName: `settings.plugins.tab`, component: Card });',
    ).length,
    1,
  );
  assert.equal(
    bans("registerSettingsCard(ctx, { slotName: `settings.plugins.tab` });")
      .length,
    1,
  );
  assert.equal(
    bans("registerSettingsCard(ctx, { component: Card });").length,
    0,
  );
});

test("a retired helper default is enforced at the actual registry call", () => {
  assert.equal(
    bans(
      'function mount(host, options) { const slotName = options.slotName ?? "settings.plugins.tab"; const slotOptions = { name: slotName }; return host.slots.register(slotOptions, Card); }',
    ).length,
    1,
  );
  assert.equal(
    bans(
      'function mount(host, { slotName = "settings.plugins.tab" }) { return host.slots.register({ name: slotName }, Card); }',
    ).length,
    1,
  );
});

test("constant templates, concatenations, property access and source order resolve", () => {
  assert.equal(
    bans(
      'const part = "settings"; const name = `${part}.plugins.tab`; ctx.slots.register({ name }, Card);',
    ).length,
    1,
  );
  assert.equal(
    bans(
      'const table = { tab: "settings." + "plugins.tab" }; ctx.slots.register({ name: table["tab"] }, Card);',
    ).length,
    1,
  );
  assert.equal(
    bans(
      'const old = { name: "settings.plugins.tab" }; ctx.slots.register({ ...old, name: "plugins.row.config" }, Body);',
    ).length,
    0,
  );
  assert.equal(
    bans(
      'ctx.slots.register({ name: conditional ? "plugins.row.config" : "settings.plugins.tab" }, Card);',
    ).length,
    1,
  );
});

test("lexical shadowing cannot borrow an unrelated constant", () => {
  const result = inspect(
    'const name = "settings.plugins.tab"; function mount() { const name = "plugins.row.config"; ctx.slots.register({ name }, Card); }',
  );
  assert.deepEqual(result.findings, []);
});

test("unresolved dynamic values are measured, and malformed source has diagnostics", () => {
  assert.equal(
    inspect("ctx.slots.register({ name: externalValue }, Card);").dynamic,
    1,
  );
  const result = inspect('ctx.slots.register({ name: "settings.plugins.tab" ');
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.rule === "seat-source-unreadable" && finding.line === 1,
    ),
  );
});

test("source inventory covers plugins and packages, helper defaults and orphan tables", () => {
  const root = mkdtempSync(path.join(tmpdir(), "retired-seats-"));
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  try {
    write(
      "plugins/demo/src/client.ts",
      'ctx.slots.register({name: "settings.plugins.tab"}, Card);',
    );
    write(
      "packages/demo/src/client/helper.ts",
      'function mount(ctx, name = "settings.plugin.item") { ctx.slots.register({name}, Card); }',
    );
    write(
      "packages/demo/src/client/tab-labels.ts",
      'throw new Error("never execute"); export const labels = {};',
    );
    write(
      "plugins/demo/tests/client.ts",
      'ctx.slots.register({name: "settings.plugins.tab"}, Card);',
    );
    write(
      "plugins/demo/lib/client.js",
      'ctx.slots.register({name: "settings.plugins.tab"}, Card);',
    );
    const result = verifyRetiredSeats(root);
    assert.equal(result.files, 3);
    assert.equal(
      result.findings.filter((finding) => finding.rule === "retired-seat")
        .length,
      2,
    );
    assert.equal(
      result.findings.filter((finding) => finding.rule === "orphan-tab-labels")
        .length,
      1,
    );
    assert.throws(() => verifyPublishablePlugins(root), /\[retired-seat\]/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
