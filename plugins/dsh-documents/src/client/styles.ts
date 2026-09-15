import { PLUGIN_CARD_SHELL_CSS } from "@yadsh/dsh-plugin-kit/client";

/**
 * Card body styles. Everything is expressed in `--dsw-alias-*` tokens so light,
 * dark and system themes stay coherent; only the body is styled here — the outer
 * shell comes from the kit (AGENTS.md).
 */
export const styles: string = `${PLUGIN_CARD_SHELL_CSS}
.dsh-docs-body,.dsh-docs-body *{box-sizing:border-box}
.dsh-docs-body{padding-top:14px;display:grid;gap:16px;color:var(--dsw-alias-label-primary)}
.dsh-docs-section{display:grid;gap:10px}
.dsh-docs-section-title{display:flex;justify-content:space-between;align-items:center;gap:12px}
.dsh-docs-section-title h3{font-size:13px;margin:0}
.dsh-docs-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0;line-height:1.5}
.dsh-docs-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
.dsh-docs-field{display:grid;gap:6px;min-width:0}
.dsh-docs-field>span:first-child{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}
.dsh-docs-field-hint{font-size:10px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-docs-control{width:100%;min-height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:6px 10px;font:inherit;font-size:12px;outline:none}
.dsh-docs-control:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.dsh-docs-control:disabled{cursor:default;opacity:.45}
.dsh-docs-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px}
.dsh-docs-toggle-copy{display:grid;gap:2px}
.dsh-docs-toggle-copy strong{font-size:12px;font-weight:500}
.dsh-docs-toggle-copy span{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dsh-docs-toggle{appearance:none;width:34px;height:19px;border-radius:999px;background:var(--dsw-alias-label-dimmed);position:relative;cursor:pointer;transition:.18s;flex:none}
.dsh-docs-toggle:after{content:'';position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);transition:.18s}
.dsh-docs-toggle:checked{background:var(--dsw-alias-brand-primary)}
.dsh-docs-toggle:checked:after{transform:translateX(15px)}
.dsh-docs-toggle:disabled{cursor:default;opacity:.45}
.dsh-docs-btn{height:27px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.dsh-docs-btn.link{background:transparent}
.dsh-docs-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-docs-btn:disabled{cursor:default;opacity:.45}
.dsh-docs-notice{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
.dsh-docs-notice.warn{background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error)}
.dsh-docs-facts{display:grid;gap:6px;margin:0}
.dsh-docs-facts>div{display:grid;grid-template-columns:minmax(0,130px) minmax(0,1fr);gap:10px}
.dsh-docs-facts dt{font-size:11px;color:var(--dsw-label-tertiary,var(--dsw-alias-label-tertiary))}
.dsh-docs-facts dd{margin:0;font-size:11px;color:var(--dsw-alias-label-primary);word-break:break-word}
@media(max-width:720px){.dsh-docs-grid{grid-template-columns:1fr}}
`;
