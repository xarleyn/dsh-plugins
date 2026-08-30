export const styles = `
.plu-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.plu-header{appearance:none;width:100%;border:0;background:none;color:inherit;padding:16px;display:flex;align-items:center;gap:12px;text-align:left;cursor:pointer}
.plu-title{flex:1;min-width:0}.plu-title strong{display:block;font-size:14px;color:var(--dsw-alias-label-primary)}.plu-title span{display:block;margin-top:3px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.plu-badge{border-radius:999px;padding:2px 8px;font-size:11px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.plu-chevron{color:var(--dsw-alias-label-tertiary);transition:transform .16s}.plu-open .plu-chevron{transform:rotate(180deg)}
.plu-body{border-top:1px solid var(--dsw-alias-border-l2);padding:16px;display:flex;flex-direction:column;gap:18px}
.plu-section{display:flex;flex-direction:column;gap:10px}.plu-section h3{margin:0;font-size:13px;color:var(--dsw-alias-label-primary)}
.plu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.plu-field{display:flex;flex-direction:column;gap:6px}.plu-field>span{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.plu-select{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}.plu-select:focus{outline:none;border-color:var(--dsw-alias-border-brand)}.plu-select:disabled{opacity:.55}
.plu-hint,.plu-status,.plu-empty{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.plu-error{margin:0;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error);font-size:12px}
.plu-list{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}.plu-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(150px,220px);gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.plu-plugin{min-width:0}.plu-plugin code{display:block;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--dsw-alias-label-primary)}.plu-plugin span{display:block;margin-top:3px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
@media(max-width:720px){.plu-grid{grid-template-columns:1fr}.plu-row{grid-template-columns:1fr}}
`;
