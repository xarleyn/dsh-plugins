import { describe, expect, it } from "vitest";
import {
  QA_BRAND_TOKEN_NAMES,
  QA_SURFACE_STYLES,
} from "../../../src/client/styles.js";

/**
 * The QA page's palette is one object flattened into `--dsh-qa-*` custom
 * properties. A rule referencing a variable that object never declares is
 * silently dropped by the browser — the element simply loses its border or
 * background — so the stylesheet is checked against the palette instead of
 * being eyeballed.
 */
const INLINE_TOKENS = new Set([
  // Set from TSX or from a rule outside the root palette.
  "bleed",
  "content-width",
  "rail-band",
  "rail-inset",
  "rail-natural",
  "rail-pos",
  "rail-preview-height",
  "rail-scroll-top",
  "side-space",
]);

describe("QA surface stylesheet", () => {
  it("declares every --dsh-qa-* variable its rules reference", () => {
    const used = new Set(
      [...QA_SURFACE_STYLES.matchAll(/var\(--dsh-qa-([a-z0-9-]+)\)/gu)].map(
        (match) => match[1] ?? "",
      ),
    );
    const declared = new Set([...QA_BRAND_TOKEN_NAMES, ...INLINE_TOKENS]);
    expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("keeps the dialog chrome on the host theme tokens", () => {
    // The dialog must follow light/dark automatically, so its surfaces and
    // typography come from the themed aliases; a hard-coded color would pin
    // one theme's look into the other.
    const dialogRules = [
      ...QA_SURFACE_STYLES.matchAll(
        /\.dsh-qa-(?:settings|toolpicker)[^{}]*\{[^}]*\}/gu,
      ),
    ].map((match) => match[0] ?? "");
    expect(dialogRules.length).toBeGreaterThan(40);
    const coloured = dialogRules.filter((rule) =>
      /#[0-9a-f]{3,8}/iu.test(rule),
    );
    expect(coloured).toEqual([]);
    expect(QA_SURFACE_STYLES).toContain(
      ".dsh-qa-modal__panel--settings{width:min(840px,100%);height:min(640px,calc(100vh - 48px))}",
    );
    expect(QA_SURFACE_STYLES).toContain(
      ".dsh-qa-modal__footer button{appearance:none",
    );
    expect(QA_SURFACE_STYLES).toContain(
      ".dsh-qa-modal__footer .dsh-qa-modal__primary{border-color:transparent;background:var(--dsh-qa-accent)",
    );
    expect(dialogRules.join("")).toContain("var(--dsw-alias-border-l2)");
  });

  it("keeps the legacy profile shell out of the bundle", () => {
    expect(QA_SURFACE_STYLES).not.toContain("dsh-qa-profile");
  });

  it("pins the header row with a single auto margin", () => {
    // Two auto margins split the row's free space between two gaps, which left
    // «Файлы» stranded in the middle instead of next to the sources control.
    const rules = QA_SURFACE_STYLES.split("}").map(
      (chunk) => `${chunk.trim()}}`,
    );
    const pinned = rules.filter(
      (rule) =>
        rule.includes("margin-left:auto") && rule.includes("dsh-qa-header"),
    );
    expect(pinned).toEqual([
      ".dsh-qa-header__actions{display:flex;align-items:center;flex:none;gap:10px;margin-left:auto}",
    ]);
  });

  it("hides the composer slot a parked question takes over", () => {
    // The takeover marks the composer's slot with the `hidden` attribute and
    // keeps the component mounted behind it, so the sheet has to make that
    // attribute mean display:none — otherwise the composer would still take
    // the flow under the form, and the operator could type into it.
    expect(QA_SURFACE_STYLES).toContain(
      ".dsh-qa-composer-slot[hidden]{display:none}",
    );
  });
});
