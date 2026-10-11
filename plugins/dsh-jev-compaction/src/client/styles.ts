/**
 * Card stylesheet: body rules for this plugin's own controls.
 *
 * The frame is not here: this card is seated on the Plugins panel row, where the
 * page draws the surface, the heading and the expand control (AGENTS.md), so the
 * bundle styles its controls and nothing around them. Every colour, border and
 * surface comes from `--dsw-alias-*` tokens so light, dark, and system themes stay
 * coherent — an unknown token invalidates the whole declaration in the host page,
 * so a typo would silently drop the rule instead of failing loudly.
 *
 * The focus ring of every control this plugin renders comes from the Host's ring
 * token pair, each half with its own fallback: where a token is undeclared the
 * `outline` shorthand is invalid and the ring disappears rather than degrading. A
 * hard-coded outline of our own is the wrong repair — the Host's focus.css beats it
 * under pointer modality, and raising specificity to win that fight would draw a
 * ring the design system no longer uses. The rules are written out in full rather
 * than shared through a constant, because the contract reads them off the compiled
 * bundle text.
 */

export const styles: string = String.raw`
.jevc-body{flex-direction:column;gap:14px;padding-top:12px;display:flex}
.jevc-section{display:flex;flex-direction:column;gap:8px}
.jevc-section-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1.4}
.jevc-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}
.jevc-row{display:flex;align-items:flex-start;gap:12px}
.jevc-row-text{display:flex;flex-direction:column;flex:1;gap:2px;min-width:0}
.jevc-row-label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.4}
.jevc-row-description{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.jevc-field{display:flex;flex-direction:column;gap:4px}
.jevc-field-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}
.jevc-input{appearance:none;width:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;font-size:13px;padding:6px 8px}
.jevc-input:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:-2px}
.jevc-input:disabled{color:var(--dsw-alias-label-dimmed)}
.jevc-input--number{max-width:140px}
.jevc-inline{display:flex;align-items:center;gap:8px}
.jevc-unit{color:var(--dsw-alias-label-tertiary);font-size:12px}
.jevc-toggle{appearance:none;position:relative;flex:none;width:34px;height:20px;margin:2px 0 0;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;cursor:pointer;transition:background .16s,border-color .16s}
.jevc-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;background:var(--dsw-alias-label-secondary);border-radius:999px;transition:transform .16s,background .16s}
.jevc-toggle:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.jevc-toggle:checked::after{background:var(--dsw-alias-label-primary-foreground);transform:translateX(14px)}
.jevc-toggle:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
.jevc-toggle:disabled{cursor:default;opacity:.5}
.jevc-tags{display:flex;flex-wrap:wrap;gap:6px}
.jevc-tag{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;font-size:12px;line-height:17px}
.jevc-tag-remove{appearance:none;color:inherit;cursor:pointer;background:0 0;border:0;font:inherit;font-size:13px;line-height:1;padding:0}
.jevc-tag-remove:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
.jevc-empty{color:var(--dsw-alias-label-tertiary);font-size:12px}
.jevc-chip{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
.jevc-error{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;font-size:12px;line-height:1.5;padding:8px 10px}
.jevc-warning{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:12px;line-height:1.5;padding:8px 10px}
.jevc-status{display:flex;flex-wrap:wrap;gap:4px 16px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.jevc-status-value{color:var(--dsw-alias-label-secondary)}
.jevc-status-dot--on{color:var(--dsw-alias-state-success-primary)}
.jevc-status-dot--off{color:var(--dsw-alias-state-error-primary)}
.jevc-actions{display:flex;justify-content:flex-end;gap:8px}
.jevc-button{appearance:none;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;font-size:12px;padding:5px 10px}
.jevc-button:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed)}
.jevc-button:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:-2px}
.jevc-button:disabled{cursor:default;color:var(--dsw-alias-label-dimmed)}
.jevc-details{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 10px}
.jevc-details>summary{color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;line-height:1.5;padding:8px 0}
.jevc-details>summary:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:-2px}
.jevc-details[open]>summary{color:var(--dsw-alias-label-primary)}
.jevc-details-body{display:flex;flex-direction:column;gap:10px;padding-bottom:10px}
.jevc-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}

/* One recorded compaction run, drawn into the conversation transcript
   (SPEC §28). Its own classes on purpose: the shared shell styles a settings
   list item, and this row is a transcript row inside the host's card surface.
   Every colour, radius and font comes from the design tokens, so the row
   follows the active theme instead of asserting one. */
.jevc-run{display:flex;flex-direction:column;gap:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5}
.jevc-run-header{appearance:none;display:flex;align-items:center;gap:8px;width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;padding:2px 0}
.jevc-run-header:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
.jevc-run-title{font-size:13px;font-weight:600;line-height:1.4}
.jevc-run-badge{white-space:nowrap;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.jevc-run-badge--dry-run{color:var(--dsw-alias-state-warning-primary)}
.jevc-run-badge--skip{color:var(--dsw-alias-label-tertiary)}
.jevc-run-icon{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;margin-left:auto;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round}
.jevc-run-summary{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;color:var(--dsw-alias-label-secondary)}
.jevc-run-sep{color:var(--dsw-alias-label-dimmed)}
.jevc-run-saved{color:var(--dsw-alias-state-success-primary)}
.jevc-run-time{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.jevc-run-body{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2);margin-top:4px;padding-top:8px}
.jevc-run-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px 16px;margin:0}
.jevc-run-fact{display:flex;flex-direction:column;gap:2px;min-width:0}
.jevc-run-fact dt{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4}
.jevc-run-fact dd{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.4;font-variant-numeric:tabular-nums}
.jevc-run-note{color:var(--dsw-alias-label-tertiary);font-size:11px}
.jevc-run-line{display:flex;flex-wrap:wrap;gap:4px 10px;color:var(--dsw-alias-label-secondary);margin:0}
.jevc-run-key{color:var(--dsw-alias-label-tertiary)}
.jevc-run-actions{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--dsw-alias-label-secondary);list-style:none;margin:0;padding:0}
.jevc-run-actions li{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.jevc-run-chip{white-space:nowrap;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 8px;font-size:11px;font-weight:500;line-height:17px}
.jevc-run-chip--KEEP_FULL{color:var(--dsw-alias-state-success-primary)}
.jevc-run-chip--KEEP_TRUNCATED{color:var(--dsw-alias-state-warning-primary)}
.jevc-run-items{width:100%;border-collapse:collapse;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
.jevc-run-items th{color:var(--dsw-alias-label-tertiary);font-weight:500;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l2);padding:4px 8px 4px 0}
.jevc-run-items td{border-bottom:1px solid var(--dsw-alias-border-l2);padding:4px 8px 4px 0;vertical-align:top}
.jevc-run-items tr:last-child td{border-bottom:0}
.jevc-run-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.jevc-run-foot{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;margin:0}
.jevc-run--skip .jevc-run-skip-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.jevc-run-reason{color:var(--dsw-alias-label-secondary)}
`;
