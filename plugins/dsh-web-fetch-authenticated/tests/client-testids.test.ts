/**
 * The `data-testid` contract of the settings card (epic #453).
 *
 * The card ships no DOM-rendering tests: a browser run is what addresses this
 * markup, and it does so by id. The rules that make an id addressable there —
 * ASCII kebab-case, the owning zone in the prefix, one value per node in the
 * package, and no control left unnamed — are therefore checked against the
 * source, the same way the content guide next to this file is.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT_DIR = fileURLToPath(new URL("../src/client/", import.meta.url));

/**
 * Walked rather than listed. The sections were one `sections.tsx` until #423
 * split them across `sections/`; a hardcoded path kept reading, read the barrel
 * that replaced it, and stopped seeing the markup it was meant to check.
 */
function sourcesOf(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  const directories: string[] = [];
  for (const entry of entries) {
    const at = join(dir, entry.name);
    if (entry.isDirectory()) directories.push(at);
    else if (entry.name.endsWith(".tsx")) files.push(at);
  }
  return [...files, ...directories.flatMap(sourcesOf)].sort();
}

const sources = sourcesOf(CLIENT_DIR).map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

/**
 * A node either carries the attribute itself or reaches it through the
 * `testId` prop of `Pill`, `ToggleRow` and `IconButton`, which render the value
 * onto the element verbatim. Both spellings name the same contract. A row
 * template carries its id as the last field of the tuple whose `map` spreads it
 * into `data-testid={testId}`, so that shape is read too.
 */
function testIds(source: string): string[] {
  const attributes = [...source.matchAll(/(?:data-testid|testId)="([^"]*)"/gu)];
  const tuples = [...source.matchAll(/,\s*"([^"]*)"\s*,?\s*\]/gu)].filter(
    (match) => (match[1] as string).startsWith("wfa-"),
  );
  return [...attributes, ...tuples].map((match) => match[1] as string);
}

const ids = sources.flatMap((entry) => testIds(entry.text));

/** Sections of the card, each owning one prefix of every id it renders. */
const ZONES = ["card", "status", "global", "rule", "rules", "diagnostics"];

/**
 * Nodes a browser run has to reach: every control, every disclosure, and every
 * call site of a shared control. A tag list rather than a CSS query, because
 * the check reads the source and not a tree.
 */
const ADDRESSABLE = [
  "IconButton",
  "Pill",
  "ToggleRow",
  "button",
  "details",
  "input",
  "select",
  "summary",
  "textarea",
];

/**
 * The attributes of one element, up to the `>` that opens its children. Quotes
 * and braces are tracked so a `>` inside an expression or a string does not end
 * the block early.
 */
function attributeBlock(source: string, from: number): string | null {
  let depth = 0;
  let quote: string | undefined;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return source.slice(from, index);
    else if (char === "<" && depth === 0) return null;
  }
  return null;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function unnamedNodes(): string[] {
  const gaps: string[] = [];
  for (const { path, text } of sources) {
    for (const tag of ADDRESSABLE) {
      const pattern = new RegExp(`<${tag}(?=[\\s/>])`, "gu");
      for (const match of text.matchAll(pattern)) {
        const block = attributeBlock(text, (match.index ?? 0) + tag.length + 1);
        const at = `${path.slice(CLIENT_DIR.length)}:${lineOf(text, match.index ?? 0)}`;
        if (block === null) {
          gaps.push(`${at} <${tag}> — the element could not be read`);
        } else if (!/(?:data-testid|testId)/u.test(block)) {
          gaps.push(`${at} <${tag}>`);
        }
      }
    }
  }
  return gaps;
}

describe("authenticated fetch settings test ids", () => {
  it("names every id in ASCII kebab-case", () => {
    expect(
      ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/u.test(id)),
    ).toStrictEqual([]);
  });

  it("puts the owning zone in the prefix, one zone per section", () => {
    // The rule row, its editor, its credential control and its tester are all
    // surfaces of the Rules section, so they share the `rule` zone instead of
    // minting a zone of their own per block.
    const offenders = ids.filter(
      (id) =>
        !id.startsWith("wfa-") ||
        !ZONES.includes(id.slice(4).split("-")[0] ?? ""),
    );
    expect(offenders).toStrictEqual([]);
  });

  it("uses each id once in the package", () => {
    // A repeated node — a rule row, a credential line — carries the value of
    // its template, so the string still appears once in the source.
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toStrictEqual(
      [],
    );
  });

  it("leaves no control or disclosure unnamed", () => {
    // The point of the pass is that a browser run never has to reach a node by
    // its English copy or by a class it shares with its siblings, so a control
    // without an id is the defect, not a name the run can work around.
    expect(unnamedNodes()).toStrictEqual([]);
  });

  it("gives every section a shell of its own", () => {
    // All four sections render the same `wfa-section` element, so a query that
    // reads as "the rules are listed" cannot be asked of the class or the
    // heading alone.
    for (const section of [
      "wfa-status-section",
      "wfa-rules-section",
      "wfa-global-section",
      "wfa-diagnostics-section",
    ]) {
      expect(ids).toContain(section);
    }
  });

  it("names the disclosure that opens the collapsed fields", () => {
    // The advanced block renders closed by default, so without an id on its
    // summary the ten fields behind it are reachable only by clicking a phrase.
    expect(ids).toContain("wfa-rule-editor-advanced-summary");
  });

  it("names each network checkbox by the policy field it writes", () => {
    // Six checkboxes share one `<div className="wfa-checks">`; the copy is the
    // only other way to tell them apart, and it is English prose.
    for (const field of [
      "public",
      "private",
      "loopback",
      "link-local",
      "cgnat",
      "ipv6-ula",
    ]) {
      expect(ids).toContain(`wfa-rule-editor-network-${field}`);
    }
  });
});
