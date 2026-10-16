import { settingsBodyStyles } from "@yadsh/dsh-plugin-kit/client";

/**
 * Card body styles.
 *
 * The shell is not here: this card sits on the Plugins panel row, where the page
 * draws the frame, the heading and the expand control (AGENTS.md), so the bundle
 * renders the body and nothing around it. Everything is expressed in
 * `--dsw-alias-*` tokens so light, dark and system themes stay coherent, and the
 * focus ring of every control this package draws itself comes from the Host's
 * ring tokens. Both halves carry a fallback: an undeclared token makes the whole
 * `outline` shorthand invalid, and the ring disappears instead of degrading. A
 * hard-coded outline of our own is no answer either — the Host's `focus.css`
 * wins that fight on specificity under pointer modality.
 */
export const styles: string =
  `.dsh-docs-body,.dsh-docs-body *{box-sizing:border-box}
.dsh-docs-body{padding-top:14px;display:grid;gap:16px;color:var(--dsw-alias-label-primary)}
.dsh-docs-section-title{display:flex;justify-content:space-between;align-items:center;gap:12px}
.dsh-docs-section-title h3{font-size:13px;margin:0}
.dsh-docs-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0;line-height:1.5}
.dsh-docs-btn.link{background:transparent}
.dsh-docs-notice.warn{background:color-mix(in srgb, var(--dsw-alias-state-error-primary, #b3261e) 8%, transparent);color:var(--dsw-alias-state-error-primary, #b3261e)}
.dsh-docs-facts{display:grid;gap:6px;margin:0}
.dsh-docs-facts>div{display:grid;grid-template-columns:minmax(0,130px) minmax(0,1fr);gap:10px}
.dsh-docs-facts dt{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-docs-facts dd{margin:0;font-size:11px;color:var(--dsw-alias-label-primary);word-break:break-word}
@media(max-width:720px){}
` +
  settingsBodyStyles({
    body: ".dsh-docs-body",
    section: ".dsh-docs-section",
    sectionTitle: ".dsh-docs-section-title",
    grid: ".dsh-docs-grid",
    field: ".dsh-docs-field",
    fieldLabel: ".dsh-docs-field>span:first-child",
    hint: ".dsh-docs-field-hint",
    control: ".dsh-docs-control",
    button: ".dsh-docs-btn",
    toggleRow: ".dsh-docs-toggle-row",
    toggleCopy: ".dsh-docs-toggle-copy",
    toggle: ".dsh-docs-toggle",
    notice: ".dsh-docs-notice",
  });
