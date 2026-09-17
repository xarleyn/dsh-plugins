/**
 * CSS of the shared credential-help note. Plugins append it next to their own
 * card rules; like the card shell it uses only canonical `--dsw-alias-*` tokens,
 * so light, dark and system themes stay coherent.
 */
export const CREDENTIAL_HELP_CSS = `
.dsh-credential-help{margin:0;font-size:12px;line-height:1.55;display:flex;flex-direction:column;gap:8px}
.dsh-credential-help__trigger{appearance:none;width:fit-content;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:1.55;text-align:left;text-decoration:underline;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.dsh-credential-help__trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.dsh-credential-help__chevron{width:12px;height:12px;flex:none;transition:transform .16s}
.dsh-credential-help__trigger[aria-expanded="true"] .dsh-credential-help__chevron{transform:rotate(180deg)}
.dsh-credential-help__panel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-secondary)}
.dsh-credential-help__title{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
.dsh-credential-help__text{margin:0}
.dsh-credential-help__steps,.dsh-credential-help__list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.dsh-credential-help__steps{list-style:decimal}
.dsh-credential-help__group{display:flex;flex-direction:column;gap:5px}
.dsh-credential-help__label{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600}
.dsh-credential-help__links{display:flex;flex-wrap:wrap;gap:12px}
.dsh-credential-help__links a,.dsh-credential-help__link{color:var(--dsw-alias-brand-primary);text-decoration:underline}
.dsh-credential-help__links a:focus-visible,.dsh-credential-help__link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
`;
