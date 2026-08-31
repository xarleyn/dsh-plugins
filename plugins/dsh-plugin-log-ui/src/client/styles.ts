export const styles = `
.dsh-plugin-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dsh-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-plugin-card--open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-plugin-card__header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dsh-plugin-card__header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-plugin-card__head-text{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dsh-plugin-card__name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dsh-plugin-card__description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dsh-plugin-card__badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dsh-plugin-card__chevron{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.dsh-plugin-card--open .dsh-plugin-card__chevron{transform:rotate(180deg)}
.dsh-plugin-card__body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.plu-body{padding-top:16px;display:flex;flex-direction:column;gap:18px}
.plu-section{display:flex;flex-direction:column;gap:10px}.plu-section h3{margin:0;font-size:13px;color:var(--dsw-alias-label-primary)}
.plu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.plu-field{display:flex;flex-direction:column;gap:6px}.plu-field>span{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.plu-select{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}.plu-select:focus{outline:none;border-color:var(--dsw-alias-border-brand)}.plu-select:disabled{opacity:.55}
.plu-hint,.plu-status,.plu-empty{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.plu-error{margin:0;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error);font-size:12px}
.plu-list{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}.plu-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(150px,220px);gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.plu-plugin{min-width:0}.plu-plugin code{display:block;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--dsw-alias-label-primary)}.plu-plugin span{display:block;margin-top:3px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
@media(max-width:720px){.plu-grid{grid-template-columns:1fr}.plu-row{grid-template-columns:1fr}}
`;
