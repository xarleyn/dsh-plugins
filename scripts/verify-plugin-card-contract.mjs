import assert from "node:assert/strict";

const CANONICAL_SHELL_RULES = [
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

export function verifyPluginCardContract(client, { legacyPatterns = [] } = {}) {
  for (const rule of CANONICAL_SHELL_RULES) {
    assert.ok(client.includes(rule), `client bundle must contain canonical shell rule ${rule}`);
  }

  assert.match(client, /m3\.5 5\.25 3\.5 3\.5 3\.5-3\.5/u);
  assert.doesNotMatch(client, /[\u2304\u25be]/u, "font glyphs must not be used as disclosure chevrons");
  assert.doesNotMatch(
    client,
    /--dsw-alias-border-label-dimmed/u,
    "the shell must only use canonical DSH design tokens",
  );

  for (const pattern of legacyPatterns) {
    assert.doesNotMatch(client, pattern, `client bundle still contains legacy shell ${pattern}`);
  }
}
