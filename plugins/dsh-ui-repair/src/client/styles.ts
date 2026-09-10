import { PLUGIN_CARD_SHELL_CSS } from "@yadsh/dsh-plugin-kit/client";

export const styles = `${PLUGIN_CARD_SHELL_CSS}
.uir-body,.uir-body *{box-sizing:border-box}
.uir-body{padding-top:16px;display:grid;gap:18px;color:var(--dsw-alias-label-primary)}
.uir-section{display:grid;gap:10px}
.uir-section-title{margin:0;font-size:13px;font-weight:600;line-height:20px}
.uir-muted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
.uir-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.uir-field{display:grid;gap:6px;min-width:0}
.uir-field>span{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600}
.uir-control{width:100%;min-height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:7px 10px;font:inherit;font-size:12px;outline:none}
.uir-control:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.uir-control:disabled{cursor:default;opacity:.45}
.uir-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px}
.uir-toggle-copy{display:grid;gap:2px}
.uir-toggle-copy strong{font-size:12px;font-weight:500}
.uir-toggle-copy span{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}
.uir-toggle{appearance:none;position:relative;width:34px;height:19px;border:0;border-radius:999px;background:var(--dsw-alias-label-dimmed);cursor:pointer;flex:none;transition:background .18s}
.uir-toggle:after{content:'';position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);transition:transform .18s}
.uir-toggle:checked{background:var(--dsw-alias-brand-primary)}
.uir-toggle:checked:after{transform:translateX(15px)}
.uir-toggle:disabled{cursor:default;opacity:.45}
.uir-actions{display:flex;flex-wrap:wrap;gap:8px}
.uir-button{min-height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:11px;font-weight:600;cursor:pointer}
.uir-button:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.uir-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.uir-button:disabled{cursor:default;opacity:.45}
.uir-report{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
.uir-metric{display:grid;gap:2px;padding:9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.uir-metric strong{font-size:16px;line-height:20px}
.uir-metric span{color:var(--dsw-alias-label-tertiary);font-size:9px;text-transform:uppercase;letter-spacing:.03em}
.uir-issues{display:grid;gap:6px;margin:0;padding:0;list-style:none}
.uir-issue{display:grid;gap:7px;padding:8px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:11px}
.uir-issue-summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px}
.uir-rule{color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.uir-target{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.uir-confidence{color:var(--dsw-alias-label-tertiary)}
.uir-suggestion{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:10px}
.uir-issue-actions{display:flex;flex-wrap:wrap;gap:6px}.uir-issue-actions .uir-button{min-height:28px;padding:0 9px}
.uir-ignore-list{display:grid;gap:6px;margin:0;padding:0;list-style:none}
.uir-ignore-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:11px}
.uir-ignore-item code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.uir-ignore-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
.uir-error{margin:0;color:var(--dsw-alias-label-error);font-size:11px;line-height:17px}
@media(max-width:720px){.uir-grid{grid-template-columns:1fr}.uir-report{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
