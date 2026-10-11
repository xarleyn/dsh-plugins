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

/**
 * The sheet carries more than one 600px block; the phone layout is the one that
 * switches the sidebar off and re-lays the conversation out.
 */
function phoneLayout(): string {
  return (
    [...QA_SURFACE_STYLES.matchAll(/@media \(max-width:600px\)\{.*\}/gu)]
      .map((match) => match[0] ?? "")
      .find((block) => block.includes(".dsh-qa-sidebar")) ?? ""
  );
}

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

  it("keeps the palette control on tokens this stylesheet already ships", () => {
    // The control is the thing that switches the palette, so it has to read
    // correctly in both of them: a literal color would pin one theme's look
    // into the other, which is exactly what the choice is for.
    const rules = [
      ...QA_SURFACE_STYLES.matchAll(/\.dsh-qa-theme[^{}]*\{[^}]*\}/gu),
    ].map((match) => match[0] ?? "");
    expect(rules.length).toBeGreaterThanOrEqual(6);
    expect(
      rules.filter((rule) => /#[0-9a-f]{3,8}|rgba?\(/iu.test(rule)),
    ).toEqual([]);
    // The Host's token sheet lives in the harness, not in this repository, so a
    // `--dsw-alias-*` name nobody here has ever painted with cannot be checked
    // from this file — and an unverifiable name fails silently: the browser
    // drops the whole declaration at computed-value time without a word in the
    // console, so the only symptom is a pressed theme cube that does not look
    // pressed. Requiring a token the rest of this sheet already uses is the
    // strongest claim available offline, and it is the pairing the preview
    // toggle ships for the same `aria-pressed` state.
    const themeRules = /\.dsh-qa-theme[^{}]*\{[^}]*\}/gu;
    const named = new Set(
      [...rules.join("").matchAll(/var\(--dsw-alias-([a-z0-9-]+)\)/gu)].map(
        (match) => match[1] ?? "",
      ),
    );
    const proven = new Set(
      [
        ...QA_SURFACE_STYLES.replace(themeRules, "").matchAll(
          /var\(--dsw-alias-([a-z0-9-]+)\)/gu,
        ),
      ].map((match) => match[1] ?? ""),
    );
    expect([...named].filter((token) => !proven.has(token))).toEqual([]);
    const pressed =
      rules.find((rule) => rule.includes('[aria-pressed="true"]')) ?? "";
    expect(pressed).toContain("background:var(--dsw-alias-bg-layer-1)");
    expect(pressed).toContain("color:var(--dsw-alias-label-primary)");
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

  it("keeps the surface frame over the whole viewport", () => {
    // The chat surface and the guard's failure card share this root class, and
    // it is the fixed, inset-zero frame that keeps a crashed overlay covering
    // the host chrome instead of thinning into a partial page beside it.
    const surface = /\.dsh-qa-surface\{[^}]*\}/u.exec(QA_SURFACE_STYLES)?.[0];
    expect(surface).toContain("position:fixed");
    expect(surface).toContain("inset:0");
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

  it("gives the phone layout a finger-sized way out of the panel", () => {
    // Below 600px the panel is the whole surface, so its close control is the
    // only exit the layout leaves on screen; the sheet already demands 44px of
    // the sidebar's own controls, and the panel and the message actions belong
    // to the same promise.
    const phone = phoneLayout();
    expect(phone).toBeDefined();
    expect(phone).toContain(".dsh-qa-panel__close{width:44px;height:44px}");
    expect(phone).toContain(".dsh-qa-panel__tab{min-height:44px}");
    expect(phone).toContain(
      ".dsh-qa-message__actions button{width:44px;height:44px}",
    );
  });

  it("reads the assistant's answer at the size of the question", () => {
    // The operator's own bubble is 16px; an answer drawn smaller than the
    // question it replies to reads as the lesser of the two.
    const body = /\.dsh-qa-message__content\{[^}]*\}/u.exec(
      QA_SURFACE_STYLES,
    )?.[0];
    expect(body).toContain("font-size:16px");
    // The phone layout used to drop it to 14px; the composer keeps its 16px.
    const phone = phoneLayout();
    expect(phone).not.toMatch(/\.dsh-qa-message__content\{[^}]*font-size/u);
    expect(
      /\.dsh-qa-composer textarea\{[^}]*\}/u.exec(QA_SURFACE_STYLES)?.[0],
    ).toContain("font-size:16px");
  });

  it("takes the unrevealed row action out of the hit test", () => {
    // A chat row carries its delete control at its right edge and shows it on
    // hover only. Transparency alone does not step out of the way: measured in
    // Chromium, a click that reached that edge with no pointer over the row
    // pressed the control, because an invisible button still answers clicks.
    // The control now takes pointer input exactly when the row reveals it, so
    // such a click falls through to the chat itself; the keyboard path is
    // unchanged, because focusing the control is itself a revealing condition.
    const hidden = /\.dsh-qa-sidebar__item-delete\{[^}]*\}/u.exec(
      QA_SURFACE_STYLES,
    )?.[0];
    expect(hidden).toContain("opacity:0");
    expect(hidden).toContain("pointer-events:none");
    const revealed =
      /\.dsh-qa-sidebar__item:hover \.dsh-qa-sidebar__item-delete[^{]*\{[^}]*\}/u.exec(
        QA_SURFACE_STYLES,
      )?.[0];
    expect(revealed).toContain("opacity:1");
    expect(revealed).toContain("pointer-events:auto");
  });
});
