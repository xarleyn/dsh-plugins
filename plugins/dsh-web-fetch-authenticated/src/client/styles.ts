import { PLUGIN_CARD_SHELL_CSS } from '@yadsh/dsh-plugin-kit/client'

export const styles: string = `${PLUGIN_CARD_SHELL_CSS}
.wfa-body,.wfa-body *{box-sizing:border-box}
.wfa-body{padding-top:16px;display:grid;gap:18px;color:var(--dsw-alias-label-primary)}
.wfa-section{display:grid;gap:12px}
.wfa-section-title{display:flex;justify-content:space-between;align-items:center;gap:12px}
.wfa-section-title h3{font-size:13px;margin:0}
.wfa-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0;line-height:1.5}
.wfa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
.wfa-field{display:grid;gap:6px;min-width:0}
.wfa-field>span{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}
.wfa-control{width:100%;min-height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:7px 10px;font:inherit;font-size:12px;outline:none}
textarea.wfa-control{resize:vertical}
.wfa-control:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.wfa-control:disabled{cursor:default;opacity:.45}
.wfa-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px}
.wfa-toggle-copy{display:grid;gap:2px}
.wfa-toggle-copy strong{font-size:12px;font-weight:500}
.wfa-toggle-copy span{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.wfa-toggle{appearance:none;width:34px;height:19px;border-radius:999px;background:var(--dsw-alias-label-dimmed);position:relative;cursor:pointer;transition:.18s;flex:none}
.wfa-toggle:after{content:'';position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);transition:.18s}
.wfa-toggle:checked{background:var(--dsw-alias-brand-primary)}
.wfa-toggle:checked:after{transform:translateX(15px)}
.wfa-toggle:disabled{cursor:default;opacity:.45}
.wfa-btn{height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.wfa-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.wfa-btn.primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-3)}
.wfa-btn.danger{color:var(--dsw-alias-label-error)}
.wfa-btn.link{height:27px;padding:0 8px;background:transparent}
.wfa-btn:disabled{cursor:default;opacity:.45}
.wfa-rules{display:grid;gap:6px}
.wfa-rule{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:9px;align-items:center;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:11px}
.wfa-rule-main{display:grid;gap:3px;min-width:0}
.wfa-rule-name{color:var(--dsw-alias-label-primary);font-weight:600}
.wfa-rule-origin{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.wfa-actions{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.wfa-pill{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 7px;white-space:nowrap}
.wfa-pill.ok{color:var(--dsw-alias-state-business-primary)}
.wfa-pill.warn{color:var(--dsw-alias-label-secondary)}
.wfa-pill.err{color:var(--dsw-alias-label-error)}
.wfa-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.wfa-check{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.wfa-report{display:grid;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px 12px;font-size:11px}
.wfa-report b{font-weight:600;color:var(--dsw-alias-label-secondary)}
.wfa-report pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary);max-height:160px;overflow:auto}
.wfa-error{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error);font-size:11px}
.wfa-warnings{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px}
.wfa-empty{padding:22px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wfa-editor{display:grid;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px}
.wfa-advanced{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 12px}
.wfa-advanced summary{cursor:pointer;padding:11px 0;font-size:12px;font-weight:600}
.wfa-advanced-content{padding:2px 0 13px;display:grid;gap:10px}
.wfa-note{font-size:10px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
@media(max-width:720px){.wfa-grid{grid-template-columns:1fr}.wfa-checks{grid-template-columns:1fr}.wfa-rule{grid-template-columns:minmax(0,1fr)}.wfa-actions{justify-content:flex-start}}
`
