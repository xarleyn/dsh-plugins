import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_SHELL_RULES,
  verifyCanonicalShell,
  verifyPluginCardContract,
} from "./verify-plugin-card-contract.mjs";

/*
 * A bundle is read the way the built `lib/client.js` is read: the seat string the
 * registration passes to `slots.register`, and the shell it renders. Which contract
 * applies is decided by that string, not by the plugin's verify script, so every
 * fixture here names the seat it claims to sit on.
 */
const SETTINGS_REGISTRATION = `slots.register({ name: "settings.plugins.tab" }, SettingsPage);`;

/**
 * A bundle that satisfies the whole settings contract: the canonical sheet, the
 * inline chevron, and the code that renders the shell.
 */
const CANONICAL_BUNDLE = [
  SETTINGS_REGISTRATION,
  ...CANONICAL_SHELL_RULES,
  `const path = "m3.5 5.25 3.5 3.5 3.5-3.5";`,
  `const cls = open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card";`,
  `jsx("button", { className: "dsh-plugin-card__header", "aria-expanded": open });`,
].join("\n");

const ROW_REGISTRATION = `slots.register({ name: "plugins.row.config", key: "@yadsh/demo#demo" }, RowEntry);`;

/** A card seated on the panel row: the body only, the Host's ring tokens. */
const ROW_BODY_ONLY = [
  ROW_REGISTRATION,
  `const RowEntry = () => jsx("section", { className: "demo-body" });`,
  `.demo-body button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))}`,
].join("\n");

test("accepts a settings card that renders the canonical shell", () => {
  assert.doesNotThrow(() => {
    verifyPluginCardContract(CANONICAL_BUNDLE);
  });
});

test("rejects a bundle that keeps the stylesheet but never renders the shell", () => {
  // The whole stylesheet and the chevron shape are present, so the styling half
  // passes; the card is drawn by the plugin itself and never carries the shell's
  // open state, which is the drift the shell contract exists to catch.
  const styled = [
    SETTINGS_REGISTRATION,
    ...CANONICAL_SHELL_RULES,
    `const path = "m3.5 5.25 3.5 3.5 3.5-3.5";`,
  ].join("\n");
  assert.throws(() => {
    verifyPluginCardContract(styled);
  }, /open-state/u);
});

test("rejects a card whose header does not toggle", () => {
  const withoutToggle = CANONICAL_BUNDLE.replace('"aria-expanded": open', "");
  assert.throws(() => {
    verifyPluginCardContract(withoutToggle);
  }, /aria-expanded/u);
});

test("rejects unrelated shell marker strings elsewhere in the bundle", () => {
  const unrelated = [
    SETTINGS_REGISTRATION,
    ...CANONICAL_SHELL_RULES,
    `const path = "m3.5 5.25 3.5 3.5 3.5-3.5";`,
    `const unused = "dsh-plugin-card dsh-plugin-card--open";`,
    `jsx("button", { className: "dsh-plugin-card__header" });`,
    `jsx("div", { "aria-expanded": open });`,
  ].join("\n");
  assert.throws(() => {
    verifyPluginCardContract(unrelated);
  }, /conditionally render|same button/u);
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

/*
 * The Plugins panel row is the mirror image of everything above: the Host draws the
 * card, so the classes this file requires of a settings card are what disqualify a
 * row card. The owner's word of 01.10 (variant 1 of the rc.2 migration notes) put
 * these cards on the Host's chrome, and the gate had to be turned around or the next
 * agent glues the shell back on.
 */
test("accepts a body-only card seated on the Plugins panel row", () => {
  assert.doesNotThrow(() => {
    verifyPluginCardContract(ROW_BODY_ONLY);
  });
});

test("rejects our own shell on the row, where the Host draws the frame", () => {
  assert.throws(() => {
    verifyPluginCardContract(
      `${ROW_BODY_ONLY}\nconst cls = open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card";`,
    );
  }, /second frame/u);
});

test("rejects our own chevron on the row, where the Host draws the toggle", () => {
  assert.throws(() => {
    verifyPluginCardContract(
      `${ROW_BODY_ONLY}\nconst path = "m3.5 5.25 3.5 3.5 3.5-3.5";`,
    );
  }, /own chevron/u);
});

test("rejects the shell stylesheet left injected into a row bundle", () => {
  // Dropping the JSX but keeping `PLUGIN_CARD_SHELL_CSS` in the stylesheet still
  // means the bundle carries a shell nobody asked the Host to draw around.
  assert.throws(() => {
    verifyPluginCardContract(`${ROW_BODY_ONLY}\n${CANONICAL_SHELL_RULES[0]}`);
  }, /second frame/u);
});

test("requires a card inside the panel chrome to take the Host's focus ring tokens", () => {
  assert.throws(() => {
    verifyPluginCardContract(
      ROW_BODY_ONLY.replace(
        "var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))",
        "2px solid var(--dsw-alias-brand-primary)",
      ),
    );
  }, /focus ring tokens/u);
  // Handing the ring to the Host is the other right answer.
  assert.doesNotThrow(() => {
    verifyPluginCardContract(
      ROW_BODY_ONLY.replace(/outline:[^}]+/u, "outline:none"),
    );
  });
});

test("keeps the shared bans on the row seat", () => {
  assert.throws(() => {
    verifyPluginCardContract(`${ROW_BODY_ONLY}\nconst g = "▾";`);
  }, /font glyphs/u);
  assert.throws(() => {
    verifyPluginCardContract(
      `${ROW_BODY_ONLY}\n.x{border-color:var(--dsw-alias-border-label-dimmed)}`,
    );
  }, /canonical DSH design tokens/u);
  assert.throws(() => {
    verifyPluginCardContract(
      `${ROW_BODY_ONLY}\n.legacy-card{border:1px solid red}`,
      {
        legacyPatterns: [/\.legacy-card\{/u],
      },
    );
  }, /legacy shell/u);
});

test("refuses to choose a contract for a bundle that names no seat", () => {
  assert.throws(() => {
    verifyPluginCardContract(`const anything = 1;`);
  }, /no card seat/u);
});

test("refuses a bundle seated on the panel and on a settings surface at once", () => {
  assert.throws(() => {
    verifyPluginCardContract(`${ROW_BODY_ONLY}\n${SETTINGS_REGISTRATION}`);
  }, /one card, one seat/u);
});

/*
 * `@yadsh/dsh-plugin-kit` publishes the shell that every settings card inlines, so it
 * is held to the canonical half of the contract without claiming a seat — the kit
 * registers nothing itself.
 */
test("runs the canonical shell contract for a package that names no seat", () => {
  const shellCodeOnly = [
    ...CANONICAL_SHELL_RULES,
    `const path = "m3.5 5.25 3.5 3.5 3.5-3.5";`,
    `const cls = open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card";`,
    `jsx("button", { className: "dsh-plugin-card__header", "aria-expanded": open });`,
  ].join("\n");
  assert.doesNotThrow(() => {
    verifyCanonicalShell(shellCodeOnly);
  });
  // The dispatcher still refuses it: no seat means no idea which chrome is owed.
  assert.throws(() => {
    verifyPluginCardContract(shellCodeOnly);
  }, /no card seat/u);
});
