import { PLUGIN_CARD_SHELL_CSS } from "@yadsh/dsh-plugin-kit/client";

/**
 * Card stylesheet: the canonical shell (AGENTS.md contract) plus body rules
 * for this plugin's own controls. Every colour, border, and surface comes from
 * `--dsw-alias-*` tokens so light, dark, and system themes stay coherent.
 */
export const styles: string = `${PLUGIN_CARD_SHELL_CSS}
.msg-body,.msg-body *{box-sizing:border-box}
.msg-body{padding-top:16px;display:grid;gap:18px;color:var(--dsw-alias-label-primary)}
.msg-section{display:grid;gap:12px}
.msg-section-title{display:flex;justify-content:space-between;align-items:center;gap:12px}
.msg-section-title h3{font-size:13px;margin:0;display:flex;align-items:center;gap:7px}
.msg-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0;line-height:1.5}
.msg-modified{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform);border-radius:999px;padding:1px 7px}
.msg-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
.msg-field{display:grid;gap:6px}
.msg-field>span{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}
.msg-control{width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:12px;outline:none}
.msg-control:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.msg-control:disabled{cursor:default;opacity:.45}
.msg-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px}
.msg-toggle-copy{display:grid;gap:2px}
.msg-toggle-copy strong{font-size:12px;font-weight:500}
.msg-toggle-copy span{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.msg-toggle{appearance:none;width:34px;height:19px;border-radius:999px;background:var(--dsw-alias-label-dimmed);position:relative;cursor:pointer;transition:.18s;flex:none}
.msg-toggle:after{content:'';position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);transition:.18s}
.msg-toggle:checked{background:var(--dsw-alias-brand-primary)}
.msg-toggle:checked:after{transform:translateX(15px)}
.msg-toggle:disabled{cursor:default;opacity:.45}
.msg-btn{height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.msg-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.msg-btn:disabled{cursor:default;opacity:.45}
.msg-btn.primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-3)}
.msg-btn.link{height:27px;padding:0 8px;background:transparent}
.msg-btn.danger{color:var(--dsw-alias-label-error)}
.msg-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.msg-stat{padding:12px;border-radius:9px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2)}
.msg-stat b{display:block;font-size:17px;margin-bottom:3px}
.msg-stat span{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.msg-status{display:flex;flex-wrap:wrap;gap:8px}
.msg-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.msg-chip b{font-weight:600;color:var(--dsw-alias-label-primary)}
.msg-chip.off{color:var(--dsw-alias-label-tertiary)}
.msg-chip.audit{color:var(--dsw-alias-state-business-primary)}
.msg-chip.warn{color:var(--dsw-alias-label-secondary)}
.msg-chip.enforce{color:var(--dsw-alias-label-error)}
.msg-notice{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.msg-notice.warn{border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.msg-notice strong{color:var(--dsw-alias-label-primary)}
.msg-error{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error);font-size:11px;line-height:1.5}
.msg-advanced{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 12px}
.msg-advanced summary{cursor:pointer;padding:11px 0;font-size:12px;font-weight:600}
.msg-advanced-content{padding:2px 0 13px;display:grid;gap:10px}
.msg-rows{display:grid;gap:6px}
.msg-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:center;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:11px}
.msg-row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.msg-editor{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
.msg-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.msg-table{width:100%;border-collapse:collapse;font-size:11px;min-width:760px}
.msg-table th{text-align:left;color:var(--dsw-alias-label-tertiary);font-weight:600;background:var(--dsw-alias-bg-module-platform);padding:8px 10px}
.msg-table td{padding:9px 10px;border-top:1px solid var(--dsw-alias-border-l2);vertical-align:top}
.msg-pill{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary)}
.msg-pill.allow{color:var(--dsw-alias-state-business-primary)}
.msg-pill.warn{color:var(--dsw-alias-label-secondary)}
.msg-pill.block{color:var(--dsw-alias-label-error)}
.msg-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.msg-raw{margin-top:5px;max-width:360px;white-space:pre-wrap;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.4}
.msg-empty{padding:22px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
.msg-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.msg-footer-note{font-size:10px;color:var(--dsw-alias-label-tertiary);margin:0;line-height:1.5;max-width:60ch}
@media(max-width:720px){.msg-grid{grid-template-columns:1fr}.msg-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
