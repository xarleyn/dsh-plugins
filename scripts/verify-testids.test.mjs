import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditTestIds,
  countTestIdSites,
  testIdValues,
  verifyTestIds,
} from "./verify-testids.mjs";

function messages(source, options) {
  return auditTestIds(source, options).map((finding) => finding.message);
}

function writePlugin(root, name, relativePath, source) {
  const file = path.join(root, "plugins", name, "src", "client", relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return file;
}

function writeManifest(root, name, manifest) {
  const file = path.join(root, "plugins", name, "package.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(manifest), "utf8");
  return file;
}

test("accepts every shape the convention allows", () => {
  const sources = [
    `<section data-testid="qa-composer" />`,
    `<div data-testid="pf-audit-log-blocked">{text}</div>`,
    `<div data-testid={"qa-admin-empty"} />`,
    `<li data-testid={item.task ? "qa-md-task-item" : undefined} />`,
    `<p data-testid={props.testId ?? "qa-admin-badge"} />`,
    "<span data-testid={`${testIdZone}-boundary-cancel`} />",
    "<span data-testid={`${testIdZone}-entry-${index}`} />",
    `<Field testId={testId} />`,
    '<div data-testid={testIdPart(testId, "label")} />',
    `<div data-testid={props.testId} />`,
    `React.createElement("p", { "data-testid": "qa-files-panel" });`,
    'const selector = `[data-testid="${id}"]`;',
    `if (attribute === "data-testid") return true;`,
    `<button type="button" data-testid="wfa-rule-add">{/* data-test-id="x" */}</button>`,
  ];

  for (const source of sources) {
    assert.deepEqual(
      messages(source),
      [],
      `expected no finding for ${source.slice(0, 48)}`,
    );
  }
});

test("reports the attribute written under another spelling", () => {
  for (const written of [
    "data-test-id",
    "data-testId",
    "data-TestID",
    "data_test_id",
  ]) {
    assert.deepEqual(messages(`<div ${written}="qa-panel-row" />`), [
      `test id attribute is written "${written}"`,
    ]);
  }
  assert.deepEqual(
    messages(`React.createElement("p", { "data-test-id": "qa-x-row" });`),
    ['test id attribute is written "data-test-id"'],
  );
});

test("rejects a value that is not ASCII kebab-case", () => {
  assert.match(messages(`<div data-testid="qa-панель" />`)[0], /Cyrillic/u);
  assert.match(
    messages(`<div data-testid="qa-行-panel" />`)[0],
    /outside ASCII/u,
  );
  assert.match(messages(`<div data-testid="qa-Panel" />`)[0], /kebab-case/u);
  assert.match(
    messages(`<div data-testid="qa_panel_row" />`)[0],
    /kebab-case/u,
  );
  assert.match(messages(`<div data-testid="qa panel" />`)[0], /kebab-case/u);
  assert.match(messages(`<div data-testid="qa.panel" />`)[0], /kebab-case/u);
  assert.deepEqual(messages(`<div data-testid="" />`), [
    "carries an empty value",
  ]);
});

test("requires a zone in front of the element", () => {
  assert.deepEqual(messages(`<div data-testid="composer" />`), [
    '"composer" carries no zone prefix',
  ]);
  assert.deepEqual(messages(`<div data-testid={item ? "panel" : null} />`), [
    '"panel" carries no zone prefix',
  ]);
});

test("rejects a task number and a declared person", () => {
  for (const value of ["qa-474-panel", "qa-panel-474", "qa-dsh-453-row"]) {
    assert.match(messages(`<div data-testid="${value}" />`)[0], /task number/u);
  }
  const names = { personNames: ["xarleyn", "ivan", "petrov"] };
  assert.match(
    messages(`<div data-testid="qa-xarleyn-panel" />`, names)[0],
    /names a person/u,
  );
  assert.match(
    messages(`<div data-testid="qa-Ivan-row" />`, names)[0],
    /names a person/u,
  );
  // A digit inside a word is the product's own name, and no one's task number.
  assert.deepEqual(messages(`<div data-testid="l10n-override-row" />`), []);
  assert.deepEqual(messages(`<div data-testid="dsh-2fa-gate" />`), []);
});

test("reads the fixed text of a composed value", () => {
  assert.deepEqual(messages("<div data-testid={`${testIdZone}-474-row`} />"), [
    'names a task number in "${testIdZone}-474-row"',
  ]);
  assert.match(
    messages("<div data-testid={`${zone}-панель`} />")[0],
    /Cyrillic/u,
  );
  assert.match(
    messages("<div data-testid={`${zone}-Panel`} />")[0],
    /kebab-case/u,
  );
  const names = { personNames: ["xarleyn"] };
  assert.match(
    messages("<div data-testid={`${zone}-xarleyn`} />", names)[0],
    /names a person/u,
  );
});

test("reads nothing where nothing renders", () => {
  const sources = [
    `// rename data-test-id to data-testid before the next release`,
    `// <div data-testid="composer" />`,
    `const PROTECTED = ["editor"]; // log-ui writes data-testid="log-panel"`,
    [
      `/**`,
      ` * Every control carries the \`data-testid\` its card passes in, so a`,
      ` * browser test reaches it: <div data-testid="composer" />.`,
      ` */`,
      `export function Field({ testId }) {`,
      `  return <div data-testid={testId} />;`,
      `}`,
    ].join("\n"),
    `<button data-testid="qa-rule-add">{/* data-test-id="x" */}</button>`,
  ];

  for (const source of sources) {
    assert.deepEqual(
      messages(source),
      [],
      `expected no finding for ${source.slice(0, 48)}`,
    );
  }
});

test("keeps reading a line that carries a URI, a glob or an apostrophe", () => {
  const finding = ['"composer" carries no zone prefix'];
  const sources = [
    `<input placeholder="https://host/v1" data-testid="composer" />`,
    `const GLOB = "services/**";\n<div data-testid="composer" />`,
    `<span>viking://</span> <div data-testid="composer" />`,
    `<p>don't <span data-testid="composer" /></p>`,
    `const re = /^\\.\\//u;\n<div data-testid="composer" />`,
  ];

  for (const source of sources) {
    assert.deepEqual(
      messages(source),
      finding,
      `expected the attribute on ${source.slice(0, 40)} to be read`,
    );
  }
});

test("reads the testId prop a card hands to its own controls", () => {
  // One component down the prop becomes the rendered attribute, so the value is
  // written here and nowhere else; the prop's own name is not a misspelling.
  assert.deepEqual(messages(`<Field testId="docs-pipeline" />`), []);
  assert.deepEqual(messages(`<Field testId={'docs-pipeline'} />`), []);
  assert.deepEqual(
    messages(`const items = [{ testId: "safety-status-checks" }];`),
    [],
  );
  assert.deepEqual(messages(`<Field testId={testId} label="Mode" />`), []);
  assert.deepEqual(messages(`<Field testId="composer" />`), [
    '"composer" carries no zone prefix',
  ]);
  assert.deepEqual(messages(`<Field testId={item ? "panel" : null} />`), [
    '"panel" carries no zone prefix',
  ]);
  assert.deepEqual(messages(`<Field testId="qa-474-panel" />`), [
    'names a task number in "qa-474-panel"',
  ]);
  assert.match(messages(`<Field testId="qa-панель" />`)[0], /Cyrillic/u);
});

test("counts a prop site only where it writes a value", () => {
  assert.equal(
    countTestIdSites(
      `<Field testId="a-b" /><Field testId={testId} />` +
        `React.createElement("p", { testId: "c-d" });`,
    ),
    2,
  );
});

test("takes the zone and collision rules off a value it cannot resolve", () => {
  // The prefix is the caller's, so neither rule reaches it.
  assert.deepEqual(
    messages("<div data-testid={`${props.testId}-empty`} />"),
    [],
  );
  assert.deepEqual(messages("<div data-testid={`${testId}-2fa-row`} />"), []);
});

test("counts as a collision candidate only the value a site owns", () => {
  assert.deepEqual(
    testIdValues(
      '<div data-testid="qa-panel-row" /><div data-testid={x ?? "qa-other-row"} />' +
        "<div data-testid={`${zone}-third`} />",
    ).map((entry) => entry.value),
    ["qa-panel-row"],
  );
});

test("counts the attribute sites a source renders at", () => {
  assert.equal(
    countTestIdSites(
      '<div data-testid="a-b" data-testid="c-d" />const selector = `[data-testid="e-f"]`;',
    ),
    2,
  );
});

test("fails a package that declares one value in two files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-testids-"));
  try {
    writePlugin(
      root,
      "example-plugin",
      "panel.tsx",
      `<div data-testid="qa-panel-row">one</div>`,
    );
    writePlugin(
      root,
      "example-plugin",
      "chrome.tsx",
      `<div data-testid="qa-panel-row">two</div>`,
    );
    await assert.rejects(verifyTestIds(root), (error) => {
      // Which of the two files owns the value is the order the walk met them in,
      // so the assertion names both rather than guessing the first.
      const lines = String(error.message).split("\n- ").slice(1);
      assert.equal(lines.length, 1);
      assert.match(lines[0], /src\/client\/panel\.tsx:1/u);
      assert.match(lines[0], /src\/client\/chrome\.tsx:1/u);
      assert.match(lines[0], /"qa-panel-row" is also declared in /u);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("excuses one node named across its mutually exclusive states", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-testids-"));
  try {
    writePlugin(
      root,
      "example-plugin",
      "image.tsx",
      [
        `if (url === null) {`,
        `  return <span data-testid="qa-message-image" data-state="loading" />;`,
        `}`,
        `return <img data-testid="qa-message-image" src={url} />;`,
      ].join("\n"),
    );
    writePlugin(
      root,
      "other-plugin",
      "image.tsx",
      `<span data-testid="qa-attachment-image" />`,
    );

    const result = await verifyTestIds(root);

    assert.deepEqual(result, { sources: 2, sites: 3 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails two packages that claim one value", async () => {
  // The zone prefix is what keeps two plugins apart on one page, so a value one
  // package already owns is a collision even in the other package's own file.
  const root = await mkdtemp(path.join(tmpdir(), "verify-testids-"));
  try {
    writePlugin(
      root,
      "example-plugin",
      "panel.tsx",
      `<div data-testid="qa-panel-row">one</div>`,
    );
    writePlugin(
      root,
      "other-plugin",
      "panel.tsx",
      `<div data-testid="qa-panel-row">two</div>`,
    );
    await assert.rejects(verifyTestIds(root), (error) => {
      assert.match(
        String(error.message),
        /plugins\/other-plugin\/src\/client\/panel\.tsx:1: "qa-panel-row" is also declared in plugins\/example-plugin\/src\/client\/panel\.tsx:1/u,
      );
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asks a package's own manifest who its people are", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-testids-"));
  try {
    writeManifest(root, "example-plugin", {
      name: "@yadsh/example-plugin",
      author: "xarleyn",
    });
    writePlugin(
      root,
      "example-plugin",
      "panel.tsx",
      `<div data-testid="qa-xarleyn-panel">mine</div>`,
    );
    await assert.rejects(
      verifyTestIds(root),
      /panel\.tsx:1: names a person in "qa-xarleyn-panel"/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads a name out of an author line, not the host of its address", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-testids-"));
  try {
    writeManifest(root, "example-plugin", {
      name: "@yadsh/example-plugin",
      author: "Иван Петров <ivan@example.com>",
      contributors: ["Petr Smith <petr@example.org>"],
    });
    writePlugin(
      root,
      "example-plugin",
      "panel.tsx",
      `<div data-testid="qa-example-row">the host names no one</div>`,
    );
    assert.deepEqual(await verifyTestIds(root), { sources: 1, sites: 1 });

    writePlugin(
      root,
      "example-plugin",
      "row.tsx",
      `<Field testId="qa-ivan-row" />`,
    );
    await assert.rejects(
      verifyTestIds(root),
      /row\.tsx:1: names a person in "qa-ivan-row"/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails a prop that hands on a value another file already owns", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-testids-"));
  try {
    writePlugin(
      root,
      "example-plugin",
      "fields.tsx",
      `<div data-testid="docs-pipeline">the slot</div>`,
    );
    writePlugin(
      root,
      "example-plugin",
      "card.tsx",
      `<Section testId="docs-pipeline">the same slot</Section>`,
    );
    await assert.rejects(verifyTestIds(root), (error) => {
      // Whichever of the two files the walk met first owns the value, so the
      // assertion names both rather than guessing the order.
      const lines = String(error.message).split("\n- ").slice(1);
      assert.equal(lines.length, 1);
      assert.match(lines[0], /src\/client\/fields\.tsx:1/u);
      assert.match(lines[0], /src\/client\/card\.tsx:1/u);
      assert.match(lines[0], /"docs-pipeline" is also declared in /u);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports every finding of a workspace as path, line and reason", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "verify-testids-"));
  try {
    writePlugin(
      root,
      "example-plugin",
      "panel.tsx",
      [
        `export function Panel() {`,
        `  return (`,
        `    <div>`,
        `      <button data-testid="qa-panel-save" onClick={save}>Save</button>`,
        `      <button data-test-id="qa-panel-cancel" onClick={cancel}>Cancel</button>`,
        `      <p data-testid="qa-474-note" />`,
        `    </div>`,
        `  );`,
        `}`,
      ].join("\n"),
    );
    await assert.rejects(verifyTestIds(root), (error) => {
      assert.deepEqual(String(error.message).split("\n- ").slice(1), [
        'plugins/example-plugin/src/client/panel.tsx:5: test id attribute is written "data-test-id"',
        'plugins/example-plugin/src/client/panel.tsx:6: names a task number in "qa-474-note"',
      ]);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
