import { settingsBodyStyles } from "@yadsh/dsh-plugin-kit/client";

/*
 * The body of a card seated on the Host's Plugins row: the page draws the
 * surface, so nothing here styles a frame of our own. Focus rings come from the
 * Host's ring tokens, each half with a fallback — where `--dsw-focus-ring-width`
 * is undeclared the whole `outline` shorthand would be invalid and the ring
 * would vanish instead of degrading, and raising specificity to beat the Host's
 * `focus.css` is the wrong repair.
 */
export const styles: string =
  `
.wfa-body,.wfa-body *{box-sizing:border-box}
.wfa-body{padding-top:16px;display:grid;gap:18px;color:var(--dsw-alias-label-primary)}
.wfa-section-title{display:flex;justify-content:space-between;align-items:center;gap:12px}
.wfa-section-title h3{font-size:13px;margin:0}
.wfa-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0;line-height:1.5}
.wfa-control:focus-visible,.wfa-btn:focus-visible,.wfa-icon-btn:focus-visible,.wfa-toggle:focus-visible,.wfa-advanced summary:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.wfa-btn.primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-3)}
.wfa-btn.danger{color:var(--dsw-alias-state-error-primary, #b3261e)}
.wfa-icon-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0;flex:none}
.wfa-icon-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wfa-icon-btn.danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary, #b3261e)}
.wfa-icon-btn svg{width:14px;height:14px}
.wfa-icon-btn:disabled{cursor:default;opacity:.45}
.wfa-rules{display:grid;gap:6px}
.wfa-rule{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:9px;align-items:center;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:11px}
.wfa-rule-main{display:grid;gap:3px;min-width:0}
.wfa-rule-name{color:var(--dsw-alias-label-primary);font-weight:600}
.wfa-rule-origin{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.wfa-actions{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.wfa-pill{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 7px;white-space:nowrap}
.wfa-pill.ok{color:var(--dsw-alias-state-business-primary)}
.wfa-pill.warn{color:var(--dsw-alias-label-secondary)}
.wfa-pill.err{color:var(--dsw-alias-state-error-primary, #b3261e)}
.wfa-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.wfa-check{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.wfa-report{display:grid;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px 12px;font-size:11px}
.wfa-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px}
.wfa-meta-item{display:inline-flex;align-items:baseline;gap:5px}
.wfa-report b{font-weight:600;color:var(--dsw-alias-label-secondary)}
.wfa-report pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary);max-height:160px;overflow:auto}
.wfa-error{padding:9px 11px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary, #b3261e) 8%, transparent);color:var(--dsw-alias-state-error-primary, #b3261e);font-size:11px}
.wfa-warnings{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px}
.wfa-empty{padding:22px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wfa-editor{display:grid;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px}
.wfa-advanced{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 12px}
.wfa-advanced summary{cursor:pointer;padding:11px 0;font-size:12px;font-weight:600}
.wfa-advanced-content{padding:2px 0 13px;display:grid;gap:10px}
.wfa-note{font-size:10px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
@media(max-width:720px){.wfa-checks{grid-template-columns:1fr}.wfa-rule{grid-template-columns:minmax(0,1fr)}.wfa-actions{justify-content:flex-start}}
` +
  settingsBodyStyles({
    body: ".wfa-body",
    section: ".wfa-section",
    sectionTitle: ".wfa-section-title",
    grid: ".wfa-grid",
    field: ".wfa-field",
    fieldLabel: ".wfa-field>span",
    control: ".wfa-control",
    button: ".wfa-btn",
    toggleRow: ".wfa-toggle-row",
    toggleCopy: ".wfa-toggle-copy",
    toggle: ".wfa-toggle",
  });
