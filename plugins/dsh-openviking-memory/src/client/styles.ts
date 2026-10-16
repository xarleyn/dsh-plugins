import { settingsBodyStyles } from "@yadsh/dsh-plugin-kit/client";

/**
 * Card stylesheet: body rules for this plugin's own controls.
 *
 * The shell is not here — this card sits on the Plugins panel row, where the page
 * draws the frame, the heading and the expand control (AGENTS.md). Every colour,
 * border, and surface comes from `--dsw-alias-*` tokens so light, dark, and system
 * themes stay coherent, and the focus ring is the Host's own token pair rather than
 * a hard-coded outline, because `focus.css` of the Host would suppress the latter.
 * Both halves of the pair carry a fallback: where a token is undeclared the whole
 * `outline` shorthand is invalid and the ring disappears instead of degrading.
 */
export const styles: string =
  `.ovm-body,.ovm-body *{box-sizing:border-box}
.ovm-body{padding-top:16px;display:grid;gap:18px;color:var(--dsw-alias-label-primary)}
.ovm-section-title h3{font-size:13px;margin:0;font-weight:600}
.ovm-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0;line-height:1.5}
.ovm-area{width:100%;min-height:72px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:8px 10px;font:inherit;font-size:12px;line-height:1.5;outline:none}
.ovm-area:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:-1px}
.ovm-area:disabled{cursor:default;opacity:.45}
.ovm-override{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform);border-radius:999px;padding:1px 7px}
.ovm-notice{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.ovm-notice strong{color:var(--dsw-alias-label-primary)}
.ovm-error{padding:9px 11px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary, #b3261e) 8%, transparent);color:var(--dsw-alias-state-error-primary, #b3261e);font-size:11px;line-height:1.5}
.ovm-advanced{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 12px}
.ovm-advanced summary{cursor:pointer;padding:11px 0;font-size:12px;font-weight:600}
.ovm-advanced-content{padding:2px 0 13px;display:grid;gap:10px}
.ovm-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.ovm-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.ovm-footer-note{font-size:10px;color:var(--dsw-alias-label-tertiary);margin:0;line-height:1.5;max-width:60ch}
@media(max-width:720px){}
` +
  settingsBodyStyles({
    body: ".ovm-body",
    section: ".ovm-section",
    sectionTitle: ".ovm-section-title",
    grid: ".ovm-grid",
    field: ".ovm-field",
    fieldLabel: ".ovm-field>span",
    control: ".ovm-control",
    button: ".ovm-btn",
    toggleRow: ".ovm-toggle-row",
    toggleCopy: ".ovm-toggle-copy",
    toggle: ".ovm-toggle",
  });
