export const styles = String.raw`
.dsh-qa-integrations{display:flex;flex-direction:column;gap:20px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsh-qa-integrations__heading{margin:0;font-size:22px;line-height:1.3}
.dsh-qa-integrations__lead,.dsh-qa-integrations__hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}
.dsh-qa-integrations__card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:16px}
.dsh-qa-integrations__card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.dsh-qa-integrations__provider{margin:0;font-size:17px;line-height:1.4}
.dsh-qa-integrations__portal{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-integrations__status{border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);padding:2px 9px;font-size:11px;white-space:nowrap}
.dsh-qa-integrations__status--ok{color:var(--dsw-alias-success-primary)}
.dsh-qa-integrations__field{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:600}
.dsh-qa-integrations__input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:9px 11px;font:inherit}
.dsh-qa-integrations__input:focus-visible,.dsh-qa-integrations__button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-qa-integrations__actions{display:flex;flex-wrap:wrap;gap:8px}
.dsh-qa-integrations__button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer}
.dsh-qa-integrations__button--primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand)}
.dsh-qa-integrations__button--danger{color:var(--dsw-alias-error-primary)}
.dsh-qa-integrations__button:disabled,.dsh-qa-integrations__input:disabled{cursor:not-allowed;opacity:.55}
.dsh-qa-integrations__section{display:flex;flex-direction:column;gap:10px}
.dsh-qa-integrations__section h4{margin:0;font-size:14px}
.dsh-qa-integrations__permission{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}
.dsh-qa-integrations__permission label{display:flex;align-items:center;gap:8px}
.dsh-qa-integrations__muted{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-integrations__error{border:1px solid var(--dsw-alias-error-primary);border-radius:8px;padding:9px 11px;color:var(--dsw-alias-error-primary);font-size:13px}
.dsh-qa-integrations__notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:12px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.dsh-qa-integrations__hint code{background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:0 4px;font-size:12px}
`;
