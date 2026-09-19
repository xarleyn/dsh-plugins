import {
  CREDENTIAL_HELP_CSS,
  PLUGIN_CARD_SHELL_CSS,
} from "@yadsh/dsh-plugin-kit/client";

/**
 * The canonical settings-card shell and the shared credential-help note come
 * from the kit (AGENTS.md pins the shell), and only the tab list and what lives
 * inside the card body are this plugin's own: the provider cards the dialog page
 * and the host tab both mount.
 */
export const styles = `${PLUGIN_CARD_SHELL_CSS}${CREDENTIAL_HELP_CSS}${String.raw`
.dsh-qa-integrations__host-tab{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.dsh-qa-integrations__body{display:flex;flex-direction:column;gap:16px;padding:16px 0 8px}
.dsh-qa-integrations{display:flex;flex-direction:column;gap:20px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsh-qa-integrations__heading{margin:0;font-size:22px;line-height:1.3}
.dsh-qa-integrations__lead,.dsh-qa-integrations__hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}
.dsh-qa-integrations__card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:16px}
.dsh-qa-integrations__card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.dsh-qa-integrations__provider{margin:0;font-size:17px;line-height:1.4}
.dsh-qa-integrations__portal{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-integrations__status{border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);padding:2px 9px;font-size:11px;white-space:nowrap}
.dsh-qa-integrations__status--ok{color:var(--dsw-alias-state-success-primary)}
.dsh-qa-integrations__field{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:600}
.dsh-qa-integrations__input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:9px 11px;font:inherit}
.dsh-qa-integrations__input:focus-visible,.dsh-qa-integrations__button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-qa-integrations__actions{display:flex;flex-wrap:wrap;gap:8px}
.dsh-qa-integrations__button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer}
.dsh-qa-integrations__button--primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-qa-integrations__button--danger{color:var(--dsw-alias-state-error-primary)}
.dsh-qa-integrations__button:disabled,.dsh-qa-integrations__input:disabled{cursor:not-allowed;opacity:.55}
.dsh-qa-integrations__section{display:flex;flex-direction:column;gap:10px}
.dsh-qa-integrations__section h4{margin:0;font-size:14px}
.dsh-qa-integrations__permission{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}
.dsh-qa-integrations__permission label{display:flex;align-items:center;gap:8px}
.dsh-qa-integrations__muted{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-integrations__error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:9px 11px;color:var(--dsw-alias-state-error-primary);font-size:13px}
.dsh-qa-integrations__notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:12px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.dsh-qa-integrations__check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.dsh-qa-integrations__hint code{background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:0 4px;font-size:12px}
.qai-op__body{display:flex;flex-direction:column;gap:14px;padding:14px 0 8px}
.qai-op__muted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.qai-op__error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:9px 11px;color:var(--dsw-alias-state-error-primary);font-size:13px}
.qai-op__toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}
.qai-op__section{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.qai-op__section-summary{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;list-style:none;user-select:none}
.qai-op__section-summary::-webkit-details-marker{display:none}
.qai-op__section-summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.qai-op__section-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.qai-op__section-summary::before{content:"";width:8px;height:8px;flex:none;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:rotate(-45deg);transition:transform .16s}
.qai-op__section[open]>.qai-op__section-summary::before{transform:rotate(45deg)}
.qai-op__section-body{display:flex;flex-direction:column;gap:12px;padding:2px 14px 14px;border-top:1px solid var(--dsw-alias-border-l2)}
.qai-op__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px 18px}
.qai-op__field{display:flex;flex-direction:column;gap:6px;font-size:13px;min-width:0}
.qai-op__label{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--dsw-alias-label-primary);font-size:12.5px}
.qai-op__hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.45;font-weight:400}
.qai-op__overridden{border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);padding:0 7px;font-size:10.5px;font-weight:500;white-space:nowrap}
.qai-op__input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;width:100%;min-width:0;box-sizing:border-box}
.qai-op__input:focus-visible,.qai-op__button:focus-visible,.qai-op__section-summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.qai-op__button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 12px;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.qai-op__button:disabled{cursor:not-allowed;opacity:.55}
.qai-op__toggle-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;font-size:12.5px;padding:4px 0}
.qai-op__toggle-row--inline{align-items:center;padding:0}
.qai-op__toggle-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.qai-op__toggle-copy strong{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--dsw-alias-label-primary)}
.qai-op__toggle-copy span{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.45}
.qai-op__toggle{width:16px;height:16px;flex:none;accent-color:var(--dsw-alias-brand-primary);margin-top:2px}
.qai-op__rows{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.qai-op__row{display:flex;align-items:center;gap:8px;font-size:12.5px}
.qai-op__row-key{color:var(--dsw-alias-label-secondary);font-size:12px;flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qai-op__row-value{color:var(--dsw-alias-label-primary);font-size:12.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qai-op__row-add{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.qai-op__row-add .qai-op__input{width:auto;flex:1;min-width:120px}
.qai-op__row-remove{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11.5px;cursor:pointer;padding:2px 4px;flex:none}
.qai-op__row-remove:hover{color:var(--dsw-alias-state-error-primary)}
.qai-op__instances,.qai-op__profiles{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.qai-op__instance,.qai-op__profile{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);padding:10px;display:flex;flex-direction:column;gap:8px}
.qai-op__instance{flex-direction:row;align-items:flex-end;flex-wrap:wrap}
.qai-op__instance-cell{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex:1;min-width:110px}
.qai-op__instance-cell--wide{flex:2}
.qai-op__instance-key{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.qai-op__profile-head{display:flex;align-items:center;gap:10px}
.qai-op__profile-head strong{font-size:13px;color:var(--dsw-alias-label-primary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qai-op__profile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px 12px}
`}`;
