import { settingsBodyStyles } from "@yadsh/dsh-plugin-kit/client";

export const styles =
  `
.provider-extended{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.provider-extended p{color:var(--dsw-alias-label-secondary)}
.provider-extended fieldset{border:0;padding:0;margin:0;min-width:0}
.provider-extended label{display:flex;flex-direction:column;gap:4px}
.provider-extended input,.provider-extended select,.provider-extended textarea{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;max-width:100%;box-sizing:border-box}
.provider-extended input[type=checkbox]{width:auto;align-self:start}
.provider-extended label:has(input[type=checkbox]){flex-direction:row;align-items:center}
.provider-extended textarea{width:100%;resize:vertical}
.provider-extended button[aria-pressed=true]{border-color:var(--dsw-alias-label-primary)}
.provider-extended button:disabled,.provider-extended fieldset:disabled{opacity:.6;cursor:default}
.provider-extended :is(input,select,textarea,button,summary):focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.provider-extended__routes,.provider-extended__add,.provider-extended__actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:end}
.provider-extended__routes small{display:block;color:var(--dsw-alias-label-tertiary)}
.provider-extended__model{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 0}
.provider-extended details{margin:12px 0}
.provider-extended summary{cursor:pointer}
` +
  settingsBodyStyles({
    body: ".provider-extended",
    grid: ".provider-extended__grid",
    control:
      ".provider-extended :is(input:not([type=checkbox]),select,textarea)",
    button: ".provider-extended button",
  });
