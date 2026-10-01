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

const SHELL_CLASS = /dsh-plugin-card/u;
const CHEVRON_PATH = /m3\.5 5\.25 3\.5 3\.5 3\.5-3\.5/u;

/*
 * The Host's `focus.css` suppresses an outline under pointer modality with
 * specificity 0-3-2, so a `:focus-visible` rule of our own that hard-codes the
 * outline either loses (the ring vanishes after a mouse click) or, when the next
 * agent raises specificity to win it, draws a ring the design system no longer
 * uses. A card inside the panel's chrome has no ring of its own to write: it takes
 * the Host's tokens or hands the control over.
 */
const HOST_RING_TOKEN = "--dsw-focus-ring";
const FOCUS_OUTLINE = /:focus-visible[^{}]*\{[^}]*outline:\s*([^;}]+)/gu;

function namedSeats(client, candidates) {
  return candidates.filter((seat) => client.includes(seat));
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
    // `outline: none` hands the ring to the Host, which is the other correct answer.
    const value = outline.trim();
    const handedOver = /^(none|0|unset|revert|inherit)$/i.test(value);
    assert.ok(
      handedOver || value.includes(HOST_RING_TOKEN),
      `a card inside the panel's chrome must take the Host's focus ring tokens ` +
        `(${HOST_RING_TOKEN}-width/-color), not a hard-coded outline (${value})`,
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
  const onPanel = namedSeats(client, HOST_CHROME_SEATS);
  const onSettings = namedSeats(client, OWN_SHELL_SEATS);

  if (onPanel.length > 0 && onSettings.length > 0) {
    throw new assert.AssertionError({
      message:
        `client bundle registers on both the Plugins panel (${onPanel.join(", ")}) and ` +
        `a settings surface (${onSettings.join(", ")}) — one card, one seat, so the ` +
        "contract cannot tell which chrome this bundle owns",
      operator: "seat",
    });
  }
  if (onPanel.length > 0) return verifyHostChrome(client, options);
  if (onSettings.length > 0) return verifyCanonicalShell(client, options);

  throw new assert.AssertionError({
    message:
      `client bundle names no card seat this contract knows (${[
        ...HOST_CHROME_SEATS,
        ...OWN_SHELL_SEATS,
      ].join(
        ", ",
      )}) — a configuration card must declare the seat it renders in; a ` +
      "package that only ships the shell for others calls verifyCanonicalShell instead",
    operator: "seat",
  });
}
