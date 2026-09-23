import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditButtonNames,
  countButtonSites,
  verifyButtonNames,
} from "./verify-button-names.mjs";

function reasons(source) {
  return auditButtonNames(source).map((finding) => finding.reason);
}

function writePlugin(root, name, relativePath, source) {
  const file = path.join(root, "plugins", name, "src", "client", relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return file;
}

test("accepts every style that gives a button a name", () => {
  const sources = [
    `<button type="button" aria-label="Добавить" onClick={add} />`,
    `<button type="button" onClick={add}>Добавить</button>`,
    `<button type="button" aria-labelledby="add-label" />`,
    `<button type="button" title="Add a row" onClick={add}>+</button>`,
    `<button type="button" onClick={add}>\n  <span>Добавить</span>\n</button>`,
    `<button type="button" onClick={add}>{strings.add}</button>`,
    `<button type="button" onClick={add}>{draft.busy ? strings.saving : strings.save}</button>`,
    `<button type="button" {...props} />`,
  ];

  for (const source of sources) {
    assert.deepEqual(
      reasons(source),
      [],
      `expected no finding for ${source.split("\n")[0]}`,
    );
  }
});

test("reports a button whose children are only an icon or nothing at all", () => {
  assert.deepEqual(
    reasons(
      `<button type="button" onClick={add}>\n  <svg viewBox="0 0 14 14" aria-hidden="true">\n    <path d="m3.5 5.25 3.5 3.5 3.5-3.5" />\n  </svg>\n</button>`,
    ),
    ["no content"],
  );
  assert.deepEqual(reasons(`<button type="button" onClick={add} />`), [
    "no content",
  ]);
  assert.deepEqual(
    reasons(`<button type="button" onClick={add}>{/* icon */}</button>`),
    ["no content"],
  );
  assert.deepEqual(
    reasons(`<button type="button" onClick={add}>{icon}</button>`),
    ["children are icons only"],
  );
  assert.deepEqual(
    reasons(
      `<button type="button" onClick={add}>{collapsed ? ChevronDown() : ChevronUp()}</button>`,
    ),
    ["children are icons only"],
  );
  assert.deepEqual(
    reasons(
      `<button type="button" onClick={add}>\n  <span><TrashIcon /></span>\n</button>`,
    ),
    ["no content"],
  );
});

test("rejects empty, undefined and nested lookalike name attributes", () => {
  for (const source of [
    `<button aria-label=""><IconCheck /></button>`,
    `<button aria-label={undefined}><IconCheck /></button>`,
    `<button title={null}><IconCheck /></button>`,
    `<button data-meta={{ title: "not the button" }}><IconCheck /></button>`,
    `createElement("button", { "aria-label": "" }, IconCheck())`,
    `createElement("button", { "aria-label": undefined }, IconCheck())`,
    `createElement("button", { data: { title: "nested" } }, IconCheck())`,
  ]) {
    assert.notDeepEqual(reasons(source), [], source);
  }
});

test("reads the same button written with createElement", () => {
  assert.deepEqual(
    reasons(
      `React.createElement("button", { type: "button", "aria-label": L("关闭", "Close"), onClick }, IconCheck())`,
    ),
    [],
  );
  assert.deepEqual(
    reasons(
      `React.createElement("button", { type: "button", className: "wss-btn", onClick }, L("重试", "Retry"))`,
    ),
    [],
  );
  assert.deepEqual(
    reasons(
      `React.createElement("button", { type: "button", onClick }, on ? IconCheck() : null)`,
    ),
    ["children are icons only"],
  );
  assert.deepEqual(
    reasons(
      `React.createElement("button", { type: "button", onClick }, IconCheck())`,
    ),
    ["children are icons only"],
  );
  assert.deepEqual(
    reasons(`React.createElement("button", { type: "button", onClick })`),
    ["no content"],
  );
});

test("leaves buttons it cannot read alone instead of inventing a failure", () => {
  assert.deepEqual(
    reasons(`React.createElement("button", props, onClick)`),
    [],
  );
  assert.deepEqual(
    reasons(
      `React.createElement("button", { type: "button" }, (event) => { handle(event); })`,
    ),
    [],
  );
  assert.deepEqual(
    reasons(`createElement("button", { type: "button" }, label)`),
    [],
  );
});

test("counts every button site in a source", () => {
  assert.equal(
    countButtonSites(
      `<button aria-label="a" /><button aria-label="b" />\ncreateElement("button", { type: "button" });`,
    ),
    3,
  );
});

test("fails a workspace with the file and line of the unnamed button", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-button-names-"));
  try {
    writePlugin(
      root,
      "example-plugin",
      "panel.tsx",
      [
        `export function Panel() {`,
        `  return (`,
        `    <div>`,
        `      <button type="button" aria-label="Добавить" onClick={add} />`,
        `      <button type="button" className="panel__close" onClick={close}>`,
        `        <svg viewBox="0 0 14 14" aria-hidden="true" />`,
        `      </button>`,
        `    </div>`,
        `  );`,
        `}`,
      ].join("\n"),
    );
    await assert.rejects(
      verifyButtonNames(root),
      /plugins\/example-plugin\/src\/client\/panel\.tsx:5: button has no content/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("passes a workspace whose buttons are named", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-button-names-"));
  try {
    writePlugin(
      root,
      "example-plugin",
      "panel.tsx",
      `<button type="button" aria-label="Добавить" onClick={add}>\n  <svg viewBox="0 0 14 14" aria-hidden="true" />\n</button>`,
    );
    writePlugin(
      root,
      "example-plugin",
      "chrome.tsx",
      `React.createElement("button", { type: "button", title: "Reload" }, IconReload());`,
    );

    const result = await verifyButtonNames(root);

    assert.deepEqual(result, { sources: 2, buttons: 2 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
