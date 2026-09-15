export const BROWSER_PANEL_STYLES = `
.dsh-qa-browser-panel{height:100%;min-height:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;position:relative}
.dsh-qa-browser-panel__tabs{min-height:38px;overflow-x:auto;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);align-items:end;gap:4px;padding:6px 8px 0;display:flex}
.dsh-qa-browser-panel__tab{appearance:none;max-width:180px;min-width:90px;color:var(--dsw-alias-label-tertiary);background:transparent;border:1px solid transparent;border-radius:8px 8px 0 0;align-items:center;gap:6px;padding:6px 10px;font:inherit;font-size:12px;display:flex}
.dsh-qa-browser-panel__tab[aria-selected=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);border-bottom-color:var(--dsw-alias-bg-layer-2)}
.dsh-qa-browser-panel__tab:not(:disabled){cursor:pointer}
.dsh-qa-browser-panel__tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-qa-browser-panel__tab span:last-child{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.dsh-qa-browser-panel__toolbar{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:8px;display:flex}
.dsh-qa-browser-panel__address{height:32px;min-width:0;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;flex:1;padding:6px 10px;font:12px/18px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.dsh-qa-browser-panel__address:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-qa-browser-panel__go,.dsh-qa-browser-panel__refresh{height:32px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;font:inherit}
.dsh-qa-browser-panel__go{width:32px;font-size:17px}
.dsh-qa-browser-panel__refresh{width:32px;font-size:18px}
.dsh-qa-browser-panel__go:hover,.dsh-qa-browser-panel__refresh:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-qa-browser-panel__go:focus-visible,.dsh-qa-browser-panel__refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-qa-browser-panel__go:disabled,.dsh-qa-browser-panel__refresh:disabled{cursor:wait;opacity:.55}
.dsh-qa-browser-panel__viewport{min-height:0;background:var(--dsw-alias-bg-layer-1);place-items:center;overflow:auto;display:grid}
.dsh-qa-browser-panel__viewport:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-qa-browser-panel__viewport img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.dsh-qa-browser-panel__frame--interactive{cursor:crosshair;user-select:none}
.dsh-qa-browser-panel__empty{color:var(--dsw-alias-label-tertiary);padding:24px;text-align:center;font-size:13px;line-height:1.5}
.dsh-qa-browser-panel__status{min-height:32px;color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;font-size:11px;display:flex}
.dsh-qa-browser-panel__status-actions{align-items:center;gap:8px;display:flex}
.dsh-qa-browser-panel__control{appearance:none;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:3px 8px;font:inherit;cursor:pointer}
.dsh-qa-browser-panel__control:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-qa-browser-panel__control:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-qa-browser-panel__control:disabled{cursor:not-allowed;opacity:.6}
.dsh-qa-browser-panel__error{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-top:1px solid var(--dsw-alias-border-l2);padding:8px 10px;font-size:12px}
`;
