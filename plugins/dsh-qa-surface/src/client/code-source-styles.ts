export const codeSourceStyles = String.raw`
.dsh-qa-code-source{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}
.dsh-qa-code-source label{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;max-width:100%}
.dsh-qa-code-source select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;max-width:100%;min-width:0}
.dsh-qa-code-source select:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-qa-code-source select:disabled{opacity:.6}
.dsh-qa-code-source select:not(:disabled):hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-qa-code-source [role=status]{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-code-source [role=status]:empty{display:none}
.dsh-qa-code-source [role=alert]{color:var(--dsw-alias-state-error-primary)}
`;
