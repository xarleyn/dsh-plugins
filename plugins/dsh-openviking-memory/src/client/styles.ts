import { PLUGIN_CARD_SHELL_CSS } from "@yadsh/dsh-plugin-kit/client";

/**
 * Card stylesheet: the canonical shell (AGENTS.md contract) plus body rules
 * for this plugin's own controls. Every colour, border, and surface comes from
 * `--dsw-alias-*` tokens so light, dark, and system themes stay coherent.
 */
export const styles: string = `${PLUGIN_CARD_SHELL_CSS}
.ovm-body,.ovm-body *{box-sizing:border-box}
.ovm-body{padding-top:16px;display:grid;gap:18px;color:var(--dsw-alias-label-primary)}
.ovm-section{display:grid;gap:12px}
.ovm-section-title h3{font-size:13px;margin:0;font-weight:600}
.ovm-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0;line-height:1.5}
.ovm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
.ovm-field{display:grid;gap:6px;align-content:start}
.ovm-field>span{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600;display:flex;align-items:center;gap:6px}
.ovm-control{width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:12px;outline:none}
.ovm-control:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.ovm-control:disabled{cursor:default;opacity:.45}
.ovm-area{width:100%;min-height:72px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:8px 10px;font:inherit;font-size:12px;line-height:1.5;outline:none}
.ovm-area:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.ovm-area:disabled{cursor:default;opacity:.45}
.ovm-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px}
.ovm-toggle-copy{display:grid;gap:2px;text-align:left}
.ovm-toggle-copy strong{font-size:12px;font-weight:500}
.ovm-toggle-copy span{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.ovm-toggle{appearance:none;width:34px;height:19px;border-radius:999px;background:var(--dsw-alias-label-dimmed);position:relative;cursor:pointer;transition:.18s;flex:none}
.ovm-toggle:after{content:'';position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);transition:.18s}
.ovm-toggle:checked{background:var(--dsw-alias-brand-primary)}
.ovm-toggle:checked:after{transform:translateX(15px)}
.ovm-toggle:disabled{cursor:default;opacity:.45}
.ovm-override{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform);border-radius:999px;padding:1px 7px}
.ovm-btn{height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.ovm-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.ovm-btn:disabled{cursor:default;opacity:.45}
.ovm-notice{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.ovm-notice strong{color:var(--dsw-alias-label-primary)}
.ovm-error{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error);font-size:11px;line-height:1.5}
.ovm-advanced{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 12px}
.ovm-advanced summary{cursor:pointer;padding:11px 0;font-size:12px;font-weight:600}
.ovm-advanced-content{padding:2px 0 13px;display:grid;gap:10px}
.ovm-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.ovm-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.ovm-footer-note{font-size:10px;color:var(--dsw-alias-label-tertiary);margin:0;line-height:1.5;max-width:60ch}
@media(max-width:720px){.ovm-grid{grid-template-columns:1fr}}
`;
