import assert from "node:assert/strict";

/*
 * Two kinds of card, and the bundle itself says which one it is.
 *
 * A card mounted in the native settings surface owns its whole card, so the shared
 * shell is the thing that keeps a dozen bundles drawing the same frame.
 *
 * A card seated on the Host's Plugins panel sits *inside* the panel's own card: the
 * page draws the surface, the title, the row id and the description line before the
 * registrant's body is mounted. There the shared shell is not consistency, it is a
 * second frame and a second heading — so the class names this file requires of a
 * settings card are what it forbids here.
 *
 * The seat is read off the built bundle rather than passed in by the plugin's verify
 * script, because the declaration a plugin makes about itself is exactly the thing
 * this contract checks: a row card that leaves its shell in could otherwise keep
 * `seat: "settings"` in its verify script and pass.
 */
export const HOST_CHROME_SEATS = [
  "plugins.row.config",
  "plugins.bundle.config",
];
export const OWN_SHELL_SEATS = ["settings.section", "settings.plugins.tab"];

export const CANONICAL_SHELL_RULES = [
  ".dsh-plugin-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
  ".dsh-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
  ".dsh-plugin-card--open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
  ".dsh-plugin-card__header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
  ".dsh-plugin-card__header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
  ".dsh-plugin-card__head-text{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
  ".dsh-plugin-card__name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
  ".dsh-plugin-card__description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
  ".dsh-plugin-card__badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
  ".dsh-plugin-card__chevron{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
  ".dsh-plugin-card--open .dsh-plugin-card__chevron{transform:rotate(180deg)}",
  ".dsh-plugin-card__body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}",
];

/*
 * A shell class counts where CSS or JSX would read it: as a selector that is *used* as
 * one (`.dsh-plugin-card__header{`), or as a class value (a string opening with the
 * token). esbuild carries `src/` comments into `lib/client.js`, so a body that documents
 * what it removed — "the page, not us, draws .dsh-plugin-card__header" — is prose, not a
 * second frame; requiring the selector to be followed by `{` or `,` keeps the grouped CSS
 * form and lets the sentence stand. Banning the bare word instead would make the next
 * migrated plugin delete a correct comment to get green.
 */
const SHELL_CLASS =
  /["'`]\s*(?:[\w-]+\s+)*dsh-plugin-card|\.dsh-plugin-card[\w-]*(?=\s*[,{])/u;
const CHEVRON_PATH = /m3\.5 5\.25 3\.5 3\.5 3\.5-3\.5/u;

/*
 * The rules the shell is made of, counted in the bundle. Presence of these is what
 * "this bundle draws its own frame" means, and it is the fallback the seat resolver
 * uses when the seat cannot be read statically.
 */
function drawsCanonicalShell(client) {
  return (
    CANONICAL_SHELL_RULES.some((rule) => client.includes(rule)) ||
    SHELL_CLASS.test(client)
  );
}

/*
 * The Host's `focus.css` suppresses an outline under pointer modality with
 * specificity 0-3-2, so a `:focus-visible` rule of our own that hard-codes the
 * outline either loses (the ring vanishes after a mouse click) or, when the next
 * agent raises specificity to win it, draws a ring the design system no longer
 * uses. A card inside the panel's chrome has no ring of its own to write: it takes
 * the Host's tokens or hands the control over.
 */
const HOST_RING_TOKEN = "--dsw-focus-ring";
// A token that is not declared on the surface makes the whole `outline` shorthand invalid
// and the ring vanishes — the exact case the tokens were taken for — so *both* halves of
// the pair need a fallback, not only the width, as `AGENTS.md` prescribes.
const RING_WIDTH_FALLBACK = /--dsw-focus-ring-width\s*,\s*\S+/u;
const RING_COLOR_FALLBACK = /--dsw-focus-ring-color\s*,\s*\S+/u;
const FOCUS_OUTLINE = /:focus(?:-visible)?[^{}]*\{[^}]*outline:\s*([^;}]+)/gu;
// At least one rule must actually put the Host's ring on a control — as an outline, or
// as the inset shadow the Host itself uses where an outline would shift layout. A gate
// that only forbids a hard-coded outline is satisfied by deleting every focus rule,
// which is how a ring disappears while the check stays green.
const RING_APPLIED = /:focus(?:-visible)?[^{}]*\{[^}]*--dsw-focus-ring[^;}]*/u;

/*
 * Which contract applies is read off the *registration*, not off any occurrence of
 * the seat string: a help line, an error message, or a comment carried from `src/`
 * would otherwise switch the contract on a bundle that never registered there. The
 * shape is what `slots.register({ name: … })` compiles to, and `name` is a property
 * the Host reads at runtime, so it survives minification.
 *
 * The *value* does not survive as a literal, and requiring it did break a landed
 * plugin: `dsh-jev-compaction` and `dsh-qa-browser` register `name: SETTINGS_CARD_SLOT`,
 * and `plugin-kit`'s own helper compiles to `name: slotName`. So a seat is read from
 * the literal, and failing that from the constant the `name:` identifier is bound to.
 * Where neither reaches — a seat passed as an option into an inlined helper — the
 * bundle decides by whether it draws the canonical shell at all.
 */
const SEAT_TOKENS =
  /(?:plugins\.row|plugins\.bundle)\.config|settings\.(?:section|plugins\.tab)/u;
// The alternation is grouped on purpose: ungrouped, `["']a|b["']` reads as
// `(["']a) | (b["'])`, which lets a seat string anywhere in the bundle count as a
// registration and stops requiring the quote that opens it.
const NAME_LITERAL = new RegExp(
  `\\bname:\\s*["']((?:${SEAT_TOKENS.source}))["']`,
  "gu",
);
const NAME_IDENTIFIER = /\bname:\s*([A-Za-z_$][\w$]*)/gu;
const SEAT_BINDING = new RegExp(
  `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*["']((?:${SEAT_TOKENS.source}))["']`,
  "gu",
);

function seatMentions(client) {
  const quoted = new RegExp(`["']((?:${SEAT_TOKENS.source}))["']`, "gu");
  return new Set([...client.matchAll(quoted)].map(([, seat]) => seat));
}

function readSeats(client) {
  const seats = new Set();
  for (const [, seat] of client.matchAll(NAME_LITERAL)) seats.add(seat);

  const bindings = new Map();
  for (const [, ident, seat] of client.matchAll(SEAT_BINDING)) {
    bindings.set(ident, seat);
  }
  for (const [, ident] of client.matchAll(NAME_IDENTIFIER)) {
    const seat = bindings.get(ident);
    if (seat) seats.add(seat);
  }
  return seats;
}

function checkSharedBans(client, { legacyPatterns }) {
  assert.doesNotMatch(
    client,
    /[⌄▾]/u,
    "font glyphs must not be used as disclosure chevrons",
  );
  assert.doesNotMatch(
    client,
    /--dsw-alias-border-label-dimmed/u,
    "the shell must only use canonical DSH design tokens",
  );
  for (const pattern of legacyPatterns) {
    assert.doesNotMatch(
      client,
      pattern,
      `client bundle still contains legacy shell ${pattern}`,
    );
  }
}

/**
 * Assert the canonical *own-shell* contract — the settings-surface card that draws its
 * own frame — against a built bundle, or against the shared shell code itself.
 *
 * `verifyPluginCardContract` is what a plugin bundle is held to; this is the half it
 * runs, exported for `@yadsh/dsh-plugin-kit`, which publishes the shell that every
 * plugin inlines and names no seat of its own.
 */
export function verifyCanonicalShell(client, { legacyPatterns = [] } = {}) {
  for (const rule of CANONICAL_SHELL_RULES) {
    assert.ok(
      client.includes(rule),
      `client bundle must contain canonical shell rule ${rule}`,
    );
  }

  assert.match(client, CHEVRON_PATH);

  /*
   * The rules above prove the shell is *styled*; they say nothing about the
   * bundle rendering it. A card that injects the canonical stylesheet and then
   * draws its own outer shell — a `<div>` root, a header that is not a toggle —
   * satisfies every one of them, which is exactly the drift the shell contract
   * exists to prevent. These two assertions read the half a stylesheet cannot
   * describe: the open-state class pair occurs only in the code that renders the
   * shell, and `aria-expanded` only on the header button that toggles it.
   */
  assert.match(
    client,
    /(?:\?|&&)[^;\n]{0,240}["']dsh-plugin-card dsh-plugin-card--open["']/u,
    "client bundle must conditionally render the shell's open-state class pair",
  );
  assert.match(
    client,
    /(?:jsx|jsxs|createElement)\)?\s*\(\s*["']button["']\s*,\s*\{(?=[^}]{0,800}dsh-plugin-card__header)(?=[^}]{0,800}aria-expanded)[^}]{0,800}\}/u,
    "client bundle must render `dsh-plugin-card__header` and `aria-expanded` on the same button",
  );

  checkSharedBans(client, { legacyPatterns });
}

function verifyHostChrome(client, options) {
  assert.doesNotMatch(
    client,
    SHELL_CLASS,
    "the Plugins panel draws this card's frame, so the bundle must carry no " +
      "`dsh-plugin-card` shell — our own card inside the Host's card is a second frame",
  );
  assert.doesNotMatch(
    client,
    CHEVRON_PATH,
    "the panel draws the expand control, so the bundle must not carry our own chevron",
  );

  for (const [, outline] of client.matchAll(FOCUS_OUTLINE)) {
    const value = outline.trim();
    // `:focus` is checked as well as `:focus-visible`: a hard-coded ring under the
    // plain selector wins the same fight and is only invisible to this gate.
    const handedOver = /^(none|0|unset|revert|inherit)$/i.test(value);
    if (handedOver) continue;
    // Both halves of the pair, each with its fallback: a ring that hard-codes the width
    // and takes only the colour still loses the fight `focus.css` starts, and the
    // substring `--dsw-focus-ring` alone would call that "taking the Host's tokens".
    for (const [token, fallback, what] of [
      [`${HOST_RING_TOKEN}-width`, RING_WIDTH_FALLBACK, "length"],
      [`${HOST_RING_TOKEN}-color`, RING_COLOR_FALLBACK, "colour"],
    ]) {
      assert.ok(
        value.includes(token),
        `a card inside the panel's chrome must build its ring from the Host's ` +
          `${token} (${value})`,
      );
      assert.ok(
        fallback.test(value),
        `${token} must carry a fallback ${what}, or the declaration is dropped where ` +
          `the token is not defined (${value})`,
      );
    }
  }

  // A body whose controls keep no ring at all is the same user-visible failure as a
  // hard-coded one, and deleting the rules is the cheaper way to reach it. Asked of a
  // seat that renders no form, though, this becomes a CSS rule written for the gate —
  // so it is asked of the row, where the plugin does render controls.
  if (options.ringOwed !== false) {
    assert.match(
      client,
      RING_APPLIED,
      "the row card must put a ring on at least one of its own controls with " +
        `${HOST_RING_TOKEN}-width/-color — the Host's focus.css dresses its own elements, ` +
        "not the ones a plugin renders inside the section. A bundle that reaches this " +
        "message without naming a seat is either a card that lost its registration or a " +
        "package that owes no card contract and should call verifyCanonicalShell instead",
    );
  }

  checkSharedBans(client, options);
}

/**
 * Assert the built client bundle against the card contract of the seat it registers
 * on: the Host's Plugins panel (`plugins.row.config`, `plugins.bundle.config`) or a
 * native settings surface (`settings.section`, `settings.plugins.tab`).
 */
export function verifyPluginCardContract(client, { legacyPatterns = [] } = {}) {
  const options = { legacyPatterns };
  const seats = readSeats(client);
  const onPanel = HOST_CHROME_SEATS.filter((seat) => seats.has(seat));
  const onSettings = OWN_SHELL_SEATS.filter((seat) => seats.has(seat));

  if (onPanel.length > 0 && onSettings.length > 0) {
    throw new assert.AssertionError({
      message:
        `client bundle registers on both the Plugins panel (${onPanel.join(", ")}) and ` +
        `a settings surface (${onSettings.join(", ")}) — one card, one seat, so the ` +
        "contract cannot tell which chrome this bundle owns",
      operator: "seat",
    });
  }
  if (onPanel.length > 0)
    return verifyHostChrome(client, {
      ...options,
      // `plugins.bundle.config` is a page the Remote owns, not a settings form
      // (AGENTS.md), so a focus ring there would be a rule written for the gate.
      ringOwed: onPanel.includes("plugins.row.config"),
    });
  if (onSettings.length > 0) return verifyCanonicalShell(client, options);

  /*
   * Nothing resolved at a `name:` — because the seat reached as an option (`name:
   * slotName`, how plugin-kit's helper compiles), or because the bundle registers
   * positionally (`slots.inject("plugins.row.config", Comp)`). Ask the bundle what it
   * quotes, everywhere. The same rule as above: two surfaces named is a contradiction,
   * not a choice — otherwise a row card that kept its shell and cites
   * `"settings.plugins.tab"` in a surviving comment would be judged by the canonical
   * half, which *requires* that shell, and the second frame would pass by leaning on
   * prose. What this cannot rule out is prose quoting exactly one, wrong family; a card
   * seated on the panel should name its seat the way the registration reads.
   */
  const mentions = seatMentions(client);
  const panelMentioned = HOST_CHROME_SEATS.filter((seat) => mentions.has(seat));
  const settingsMentioned = OWN_SHELL_SEATS.filter((seat) =>
    mentions.has(seat),
  );
  if (panelMentioned.length > 0 && settingsMentioned.length > 0) {
    throw new assert.AssertionError({
      message:
        `client bundle names no seat at its registration yet quotes both the panel ` +
        `(${panelMentioned.join(", ")}) and a settings surface ` +
        `(${settingsMentioned.join(", ")}) — the contract cannot tell which chrome this ` +
        "bundle owns, so name the seat at the registration or leave the other citation out",
      operator: "seat",
    });
  }
  if (panelMentioned.length > 0) return verifyHostChrome(client, options);
  if (settingsMentioned.length > 0)
    return verifyCanonicalShell(client, options);

  /*
   * Nothing named the seat at all. The bundle still says what it is: a card that owns its
   * frame carries the shell classes, and one seated inside the Host's card carries none.
   */
  if (drawsCanonicalShell(client)) {
    return verifyCanonicalShell(client, options);
  }
  return verifyHostChrome(client, options);
}
