/**
 * Card CSS: the canonical shell (from the shared kit, so every first-party
 * card renders an identical outer surface) plus this plugin's body rules.
 * Only `--dsw-alias-*` design tokens are used: an unknown token invalidates
 * the whole declaration in the host page, so a typo would silently drop the
 * rule instead of failing loudly.
 */

import { PLUGIN_CARD_SHELL_CSS } from "@yadsh/dsh-plugin-kit/client";

export const styles = `${PLUGIN_CARD_SHELL_CSS}${String.raw`
.jevc-body{display:flex;flex-direction:column;gap:14px;padding-top:12px}
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
.jevc-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.jevc-input:disabled{color:var(--dsw-alias-label-dimmed)}
.jevc-input--number{max-width:140px}
.jevc-inline{display:flex;align-items:center;gap:8px}
.jevc-unit{color:var(--dsw-alias-label-tertiary);font-size:12px}
.jevc-toggle{appearance:none;position:relative;flex:none;width:34px;height:20px;margin:2px 0 0;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;cursor:pointer;transition:background .16s,border-color .16s}
.jevc-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;background:var(--dsw-alias-label-secondary);border-radius:999px;transition:transform .16s,background .16s}
.jevc-toggle:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.jevc-toggle:checked::after{background:var(--dsw-alias-label-primary-foreground);transform:translateX(14px)}
.jevc-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.jevc-toggle:disabled{cursor:default;opacity:.5}
.jevc-tags{display:flex;flex-wrap:wrap;gap:6px}
.jevc-tag{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;font-size:12px;line-height:17px}
.jevc-tag-remove{appearance:none;color:inherit;cursor:pointer;background:0 0;border:0;font:inherit;font-size:13px;line-height:1;padding:0}
.jevc-tag-remove:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
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
.jevc-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.jevc-button:disabled{cursor:default;color:var(--dsw-alias-label-dimmed)}
.jevc-details{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 10px}
.jevc-details>summary{color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;line-height:1.5;padding:8px 0}
.jevc-details[open]>summary{color:var(--dsw-alias-label-primary)}
.jevc-details-body{display:flex;flex-direction:column;gap:10px;padding-bottom:10px}
.jevc-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}
`}`;
