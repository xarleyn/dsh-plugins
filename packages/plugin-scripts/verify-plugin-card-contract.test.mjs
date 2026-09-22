import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_SHELL_RULES,
  verifyPluginCardContract,
} from "./verify-plugin-card-contract.mjs";

/**
 * A bundle that satisfies the whole contract: the canonical sheet, the inline
 * chevron, and the code that renders the shell.
 */
const CANONICAL_BUNDLE = [
  ...CANONICAL_SHELL_RULES,
  `const path = "m3.5 5.25 3.5 3.5 3.5-3.5";`,
  `const cls = open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card";`,
  `jsx("button", { className: "dsh-plugin-card__header", "aria-expanded": open });`,
].join("\n");

test("accepts a bundle that renders the canonical shell", () => {
  assert.doesNotThrow(() => {
    verifyPluginCardContract(CANONICAL_BUNDLE);
  });
});

test("rejects a bundle that keeps the stylesheet but never renders the shell", () => {
  // The whole stylesheet and the chevron shape are present, so the styling half
  // passes; the card is drawn by the plugin itself and never carries the shell's
  // open state, which is the drift the contract exists to catch.
  const styled = [
    ...CANONICAL_SHELL_RULES,
    `const path = "m3.5 5.25 3.5 3.5 3.5-3.5";`,
  ].join("\n");
  assert.throws(() => {
    verifyPluginCardContract(styled);
  }, /open state/u);
});

test("rejects a card whose header does not toggle", () => {
  const withoutToggle = CANONICAL_BUNDLE.replace('"aria-expanded": open', "");
  assert.throws(() => {
    verifyPluginCardContract(withoutToggle);
  }, /aria-expanded/u);
});

test("rejects a bundle missing a canonical shell rule", () => {
  const missing = CANONICAL_BUNDLE.replace(CANONICAL_SHELL_RULES[6], "");
  assert.throws(() => {
    verifyPluginCardContract(missing);
  }, /canonical shell rule/u);
});

test("rejects a font glyph used as the disclosure chevron", () => {
  assert.throws(() => {
    verifyPluginCardContract(`${CANONICAL_BUNDLE}\nconst glyph = "⌄";`);
  }, /font glyphs/u);
  assert.throws(() => {
    verifyPluginCardContract(`${CANONICAL_BUNDLE}\nconst glyph = "▾";`);
  }, /font glyphs/u);
});

test("rejects a non-canonical shell token", () => {
  assert.throws(() => {
    verifyPluginCardContract(
      `${CANONICAL_BUNDLE}\n.x{border-color:var(--dsw-alias-border-label-dimmed)}`,
    );
  }, /canonical DSH design tokens/u);
});

test("rejects the legacy outer shell a plugin brought with it", () => {
  assert.throws(() => {
    verifyPluginCardContract(
      `${CANONICAL_BUNDLE}\n.plu-card{border:1px solid red}`,
      {
        legacyPatterns: [/\.plu-card\{/u],
      },
    );
  }, /legacy shell/u);
  assert.doesNotThrow(() => {
    verifyPluginCardContract(CANONICAL_BUNDLE, {
      legacyPatterns: [/\.plu-card\{/u],
    });
  });
});
