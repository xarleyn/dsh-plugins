import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  `.demo-body button:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))}`,
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
        "var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))",
        "2px solid var(--dsw-alias-brand-primary)",
      ),
    );
  }, /must build its ring from/u);
  // `outline: none` is not an answer on its own: `focus.css` of the Host dresses the
  // Host's own elements, not a control a plugin renders inside the section, so a body
  // that hands the ring over and gives nothing has simply lost the ring.
  assert.throws(() => {
    verifyPluginCardContract(
      ROW_BODY_ONLY.replace(/outline:[^}]+/u, "outline:none"),
    );
  }, /at least one of its own controls/u);
  // What the Host itself does where an outline would shift layout — an inset shadow
  // built from the same tokens — passes.
  assert.doesNotThrow(() => {
    verifyPluginCardContract(
      ROW_BODY_ONLY.replace(
        "outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))",
        "outline:none;box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))",
      ),
    );
  });
});

test("requires a fallback length on the Host's ring width", () => {
  // An undefined `--dsw-focus-ring-width` invalidates the whole `outline` shorthand,
  // so a ring without a fallback disappears exactly where the token is missing.
  assert.throws(() => {
    verifyPluginCardContract(
      ROW_BODY_ONLY.replace(
        "var(--dsw-focus-ring-width, 2px)",
        "var(--dsw-focus-ring-width)",
      ),
    );
  }, /fallback length/u);
});

test("catches a hard-coded ring under the plain focus selector", () => {
  // `:focus` wins the same fight as `:focus-visible` and is invisible to a gate that
  // reads only the latter.
  assert.throws(() => {
    verifyPluginCardContract(
      `${ROW_REGISTRATION}\nconst RowEntry = () => jsx("section");\n.demo-input:focus{outline:2px solid var(--dsw-alias-brand-primary)}`,
    );
  }, /must build its ring from/u);
});

test("requires the row card to leave a ring on its own controls", () => {
  // The cheapest way to satisfy a gate that only forbids a hard-coded outline is to
  // delete every focus rule; the reader then has no ring at all.
  assert.throws(() => {
    verifyPluginCardContract(
      ROW_BODY_ONLY.replace(
        /^\.demo-body button:focus.*$/mu,
        ".demo-body button{color:red}",
      ),
    );
  }, /at least one of its own controls/u);
});

test("holds the bundle-level panel seat to the same chrome rule", () => {
  // A feature-owned page is mounted in the panel's page too, so the second-frame rule
  // is about the surface, not about which of the two panel seats registered it.
  const bundleBody = [
    `slots.register({ name: "plugins.bundle.config", key: "@yadsh/demo" }, BundleEntry);`,
    `const BundleEntry = () => jsx("section", { className: "demo-body" });`,
    `.demo-body button:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))}`,
  ].join("\n");
  assert.doesNotThrow(() => {
    verifyPluginCardContract(bundleBody);
  });
  assert.throws(() => {
    verifyPluginCardContract(
      `${bundleBody}\nconst cls = open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card";`,
    );
  }, /second frame/u);
});

test("does not switch the contract on a seat string that is not a registration", () => {
  // A help line mentions the panel row; the bundle is still a settings card and still
  // owes the shell. Only `slots.register({ name: … })` names a seat.
  const prose = [
    SETTINGS_REGISTRATION,
    `const help = "Plugins → plugins.row.config is where the Host seats a row card";`,
  ].join("\n");
  assert.throws(() => {
    verifyPluginCardContract(prose);
  }, /canonical shell rule/u);
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

test("reads a seat declared through a constant, as real bundles do", () => {
  // `dsh-jev-compaction` and `dsh-qa-browser` compile to `name: SETTINGS_CARD_SLOT`.
  // Reading only a literal made the gate red on a plugin that was already landed, so
  // the identifier is followed to its binding.
  const viaConst = [
    `const SETTINGS_CARD_SLOT = "settings.plugins.tab";`,
    `slots.register({ name: SETTINGS_CARD_SLOT, key: "demo" }, SettingsPage);`,
    ...CANONICAL_SHELL_RULES,
    `const path = "m3.5 5.25 3.5 3.5 3.5-3.5";`,
    `const cls = open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card";`,
    `jsx("button", { className: "dsh-plugin-card__header", "aria-expanded": open });`,
  ].join("\n");
  assert.doesNotThrow(() => {
    verifyPluginCardContract(viaConst);
  });

  // The same resolution on the panel seat: the shell is still a second frame.
  const rowViaConst = [
    `const ROW_SLOT = "plugins.row.config";`,
    `slots.register({ name: ROW_SLOT, key: "@yadsh/demo#demo" }, RowEntry);`,
    CANONICAL_SHELL_RULES[0],
  ].join("\n");
  assert.throws(() => {
    verifyPluginCardContract(rowViaConst);
  }, /second frame/u);
});

test("reads a seat from the bundle when no static form reaches it", () => {
  // `plugin-kit`'s helper compiles to `name: slotName`, where the value came from an
  // option at the call site. The contract then asks the bundle what it draws: shell
  // classes mean it owns its frame, their absence means the Host does.
  const helper = [
    `function registerSettingsSlot(host, options) {`,
    `  const slotName = options.slotName ?? SETTINGS_PLUGIN_ITEM_SLOT;`,
    `  return host.slots.register({ name: slotName, key: options.key }, options.component);`,
    `}`,
    `registerSettingsSlot(host, { slotName: "plugins.row.config", key: "@yadsh/demo#demo" });`,
    `.demo-body button:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))}`,
  ].join("\n");
  assert.doesNotThrow(() => {
    verifyPluginCardContract(helper);
  });
  assert.throws(() => {
    verifyPluginCardContract(`${helper}\n${CANONICAL_SHELL_RULES[0]}`);
  }, /second frame/u);
});

test("lets a row bundle document the shell it removed", () => {
  // esbuild keeps `src/` comments in `lib/client.js`. Naming the class in a comment is
  // how the next migrated plugin explains itself, not a frame it drew.
  const withProse = [
    ROW_REGISTRATION,
    `/** no dsh-plugin-card shell here, the page draws the frame */`,
    `const RowEntry = () => jsx("section", { className: "demo-body" });`,
    `.demo-body button:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))}`,
  ].join("\n");
  assert.doesNotThrow(() => {
    verifyPluginCardContract(withProse);
  });
});

test("holds the row card to the focus rule AGENTS.md prescribes", () => {
  // The document and the gate drift apart silently unless the canonical line itself is
  // fed through the gate: an earlier revision of this PR told the reader to write a
  // ring the same PR's checker rejected.
  const agents = readFileSync(
    new URL("../../AGENTS.md", import.meta.url),
    "utf8",
  );
  const prescribed = agents.match(
    /outline: var\(--dsw-focus-ring-width[^\n]*\)/u,
  );
  assert.ok(prescribed, "AGENTS.md must prescribe a Host ring declaration");
  assert.doesNotThrow(() => {
    verifyCanonicalShell(CANONICAL_BUNDLE);
    verifyPluginCardContract(
      `${ROW_REGISTRATION}\n.x:focus-visible{${prescribed[0]}}`,
    );
  });
});

test("requires a ring only of the seat that renders controls", () => {
  // `plugins.bundle.config` is a Remote-owned page (AGENTS.md), so asking it for a focus
  // rule buys a CSS declaration written for the gate.
  const bundleSeat = [
    `slots.register({ name: "plugins.bundle.config", key: "@yadsh/demo" }, BundleEntry);`,
    `const BundleEntry = () => jsx("section", { className: "demo-body" });`,
  ].join("\n");
  assert.doesNotThrow(() => {
    verifyPluginCardContract(bundleSeat);
  });
  // The same bundle with our shell is still the second frame.
  assert.throws(() => {
    verifyPluginCardContract(`${bundleSeat}\n${CANONICAL_SHELL_RULES[0]}`);
  }, /second frame/u);
});

test("reads a positional registration as the seat it names", () => {
  // `slots.inject("plugins.row.config", Comp)` carries no `name:` property at all. Before
  // the quoted seat was read bundle-wide, this bundle fell through to "what does it
  // draw" and a row card that kept its shell was judged by the half that requires it.
  const positional = [
    `slots.inject("plugins.row.config", (host) => new RowEntry(host));`,
    CANONICAL_SHELL_RULES[0],
  ].join("\n");
  assert.throws(() => {
    verifyPluginCardContract(positional);
  }, /second frame/u);
});

test("asks the bundle what it draws when it names no seat anywhere", () => {
  // A package that publishes the shell for others registers nothing at all; what it must
  // not be is judged by a rule it never satisfied.
  assert.throws(() => {
    verifyPluginCardContract(`${ROW_REGISTRATION}`);
  }, /ring/u);
});

test("refuses a bundle seated on the panel and on a settings surface at once", () => {
  assert.throws(() => {
    verifyPluginCardContract(`${ROW_BODY_ONLY}\n${SETTINGS_REGISTRATION}`);
  }, /one card, one seat/u);
});

test("refuses the same contradiction when the seat only reaches as an option", () => {
  // The unbound path is where a row card that kept its shell can hide: the helper erases
  // the declaration, and a `"settings.plugins.tab"` citation from a surviving comment
  // would otherwise push the bundle into the canonical half — which *requires* the shell.
  const helper = [
    `function registerSettingsSlot(host, options) {`,
    `  return host.slots.register({ name: options.slotName }, options.component);`,
    `}`,
    `registerSettingsSlot(host, { slotName: "plugins.row.config" });`,
    `const note = 'moved off "settings.plugins.tab" in rc.2';`,
    CANONICAL_SHELL_RULES[0],
  ].join("\n");
  assert.throws(() => {
    verifyPluginCardContract(helper);
  }, /cannot tell which chrome/u);
});

test("counts a dotted class in prose as prose", () => {
  // Documentation and migration notes always write the class with a leading dot, so a
  // selector that is never used as one must not read as a frame.
  const prose = [
    ROW_REGISTRATION,
    `/** the page, not us, draws .dsh-plugin-card__header */`,
    `.demo-body button:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))}`,
  ].join("\n");
  assert.doesNotThrow(() => {
    verifyPluginCardContract(prose);
  });
  // A real selector still counts, grouped form included.
  assert.throws(() => {
    verifyPluginCardContract(
      `${ROW_REGISTRATION}\n.a,.dsh-plugin-card__header{border:1px solid red}` +
        `\n.x:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, red)}`,
    );
  }, /second frame/u);
});

test("requires both halves of the ring pair, each with a fallback", () => {
  const ring = (value) =>
    `${ROW_REGISTRATION}\n.x:focus-visible{outline:${value}}`;
  // A hard-coded width with only the colour token taken still loses against focus.css.
  assert.throws(() => {
    verifyPluginCardContract(
      ring("2px solid var(--dsw-focus-ring-color, red)"),
    );
  }, /--dsw-focus-ring-width/u);
  assert.throws(() => {
    verifyPluginCardContract(
      ring(
        "var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color)",
      ),
    );
  }, /fallback colour/u);
  assert.throws(() => {
    verifyPluginCardContract(
      ring(
        "var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, red)",
      ),
    );
  }, /fallback length/u);
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
  // The dispatcher reaches the same half without a declaration: a bundle that carries
  // the shell owes the shell contract, whatever named the seat it sits on.
  assert.doesNotThrow(() => {
    verifyPluginCardContract(shellCodeOnly);
  });
});
