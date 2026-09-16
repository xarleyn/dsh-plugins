import { PLUGIN_CARD_SHELL_CSS } from "@yadsh/dsh-plugin-kit/client";

/**
 * Card stylesheet: the canonical shell (AGENTS.md contract) plus body rules
 * for this plugin's own controls. Every surface, border, and colour comes from
 * `--dsw-alias-*` tokens so light, dark, and system themes stay coherent; the
 * QA page's own palette stays out of the settings page.
 */
export const QA_SETTINGS_STYLES: string = `${PLUGIN_CARD_SHELL_CSS}
.qa-card-body,.qa-card-body *{box-sizing:border-box}
.qa-card-body{padding-top:16px;display:grid;gap:18px;color:var(--dsw-alias-label-primary)}
.qa-card-section{display:grid;gap:12px}
.qa-card-section__title{display:flex;justify-content:space-between;align-items:center;gap:12px}
.qa-card-section__title h3{font-size:13px;margin:0;display:flex;align-items:center;gap:7px}
.qa-card-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0;line-height:1.5}
.qa-card-modified{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform);border-radius:999px;padding:1px 7px}
.qa-card-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:0}
/* One field per row, like the first-party plugin cards: two columns drifted
   apart wherever a hint wrapped to a different number of lines. Fields reach
   the section directly or through a grid, so both paths share the rhythm. */
.qa-card-grid>*,.qa-card-section>.qa-card-field{padding:12px 0}
.qa-card-grid>*+*,.qa-card-section>.qa-card-field:not(:first-child){border-top:.5px solid var(--dsw-alias-border-l2)}
.qa-card-field{display:grid;gap:6px}
.qa-card-field>span{font-size:13px;color:var(--dsw-alias-label-primary);font-weight:500}
.qa-card-control{width:100%;height:34px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:13px;line-height:1.5;outline:none}
textarea.qa-card-control{height:auto;padding:8px 12px;line-height:1.5;resize:vertical}
.qa-card-control:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.qa-card-control:disabled{cursor:default;opacity:.45}
.qa-card-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.qa-card-toggle-copy{display:grid;gap:2px;min-width:0}
.qa-card-toggle-copy strong{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.qa-card-toggle-copy span{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.qa-card-toggle{appearance:none;width:34px;height:19px;border-radius:999px;background:var(--dsw-alias-label-dimmed);position:relative;cursor:pointer;transition:.18s;flex:none}
.qa-card-toggle:after{content:'';position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);transition:.18s}
.qa-card-toggle:checked{background:var(--dsw-alias-brand-primary)}
.qa-card-toggle:checked:after{transform:translateX(15px)}
.qa-card-toggle:disabled{cursor:default;opacity:.45}
.qa-card-btn{height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.qa-card-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.qa-card-btn:disabled{cursor:default;opacity:.45}
.qa-card-btn.link{height:27px;padding:0 8px;background:transparent}
.qa-card-status{display:flex;flex-wrap:wrap;gap:8px}
.qa-card-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.qa-card-chip b{font-weight:600;color:var(--dsw-alias-label-primary)}
.qa-card-chip.off{color:var(--dsw-alias-label-tertiary)}
.qa-card-notice{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.qa-card-notice.warn{border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.qa-card-error{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error);font-size:11px;line-height:1.5}
.qa-card-advanced{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 12px}
.qa-card-advanced summary{cursor:pointer;padding:11px 0;font-size:12px;font-weight:600}
.qa-card-advanced-content{padding:2px 0 13px;display:grid;gap:10px}
.qa-card-rows{display:grid;gap:6px}
.qa-card-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:center;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:11px}
.qa-card-row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.qa-card-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.qa-card-footer-note{font-size:10px;color:var(--dsw-alias-label-tertiary);margin:0;line-height:1.5;max-width:64ch}
`;
