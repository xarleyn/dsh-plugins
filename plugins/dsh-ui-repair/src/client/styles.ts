import { settingsBodyStyles } from "@yadsh/dsh-plugin-kit/client";

/**
 * Card stylesheet: body rules for this plugin's own controls.
 *
 * The shell is not here — this card sits on the Plugins panel row, where the page
 * draws the frame, the heading and the expand control (AGENTS.md). Every colour,
 * border and surface comes from `--dsw-alias-*` tokens so light, dark and system
 * themes stay coherent, and the ring on each control this file draws is the Host's
 * own token pair with a fallback on both halves: the Host's `focus.css` beats a
 * hard-coded outline of ours on specificity, and an undeclared
 * `--dsw-focus-ring-width` would invalidate the whole `outline` shorthand instead
 * of degrading it.
 */
export const styles: string =
  `.uir-body,.uir-body *{box-sizing:border-box}
.uir-body{padding-top:16px;display:grid;gap:18px;color:var(--dsw-alias-label-primary)}
.uir-section-title{margin:0;font-size:13px;font-weight:600;line-height:20px}
.uir-muted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
.uir-actions{display:flex;flex-wrap:wrap;gap:8px}
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
.uir-error{margin:0;color:var(--dsw-alias-state-error-primary, #b3261e);font-size:11px;line-height:17px}
@media(max-width:720px){.uir-report{grid-template-columns:repeat(2,minmax(0,1fr))}}
` +
  settingsBodyStyles({
    body: ".uir-body",
    section: ".uir-section",
    grid: ".uir-grid",
    field: ".uir-field",
    fieldLabel: ".uir-field>span",
    control: ".uir-control",
    button: ".uir-button",
    toggleRow: ".uir-toggle-row",
    toggleCopy: ".uir-toggle-copy",
    toggle: ".uir-toggle",
  });
