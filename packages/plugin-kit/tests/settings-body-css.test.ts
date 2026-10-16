// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { settingsBodyStyles } from "../src/client/settings-body-css.js";

describe("operator settings body stylesheet", () => {
  it("parses as CSS and confines its rules to the supplied bundle selectors", () => {
    const css = settingsBodyStyles({
      body: ".demo-body",
      grid: ".demo-grid",
      control: ".demo-control",
      toggle: ".demo-toggle",
      toggleCopy: ".demo-copy",
      button: ".demo-button",
    });
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet?.cssRules ?? []);
      expect(rules.length).toBeGreaterThan(10);
      expect(css).not.toContain("dsh-plugin-card");
      for (const control of ["control", "toggle", "button"]) {
        expect(css).toContain(
          `.demo-${control}:focus-visible{outline:var(--dsw-focus-ring-width, 2px)`,
        );
      }
      for (const rule of rules) {
        if ("selectorText" in rule) {
          for (const selector of String(rule.selectorText).split(",")) {
            expect(selector.trim()).toMatch(/^(?:textarea)?\.demo-/u);
          }
        }
      }
    } finally {
      style.remove();
    }
  });

  it("supplies both Host focus fallbacks and wrapping for annotated labels", () => {
    const css = settingsBodyStyles({
      body: ".demo",
      toggleCopy: ".demo-copy",
      toggle: ".demo-toggle",
    });
    expect(css).toContain("var(--dsw-focus-ring-width, 2px)");
    expect(css).toContain(
      "var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))",
    );
    expect(css).toContain("flex-wrap:wrap");
    expect(css).toContain("prefers-reduced-motion:reduce");
  });
});
