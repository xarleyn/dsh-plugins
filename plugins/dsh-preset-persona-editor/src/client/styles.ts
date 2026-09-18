/**
 * The page's stylesheet: the canonical card shell (imported, never retyped)
 * plus the body rules for the roster and the editor.
 *
 * Every colour comes from a `--dsw-alias-*` token so the page follows the
 * client's light, dark, and system themes; nothing here defines a surface of
 * its own.
 * @module client/styles
 */

import { PLUGIN_CARD_SHELL_CSS } from "@yadsh/dsh-plugin-kit/client";

const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const BODY = `
.preset-persona{display:flex;flex-direction:column;gap:12px}
.preset-persona__intro{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5;margin:0}
.preset-persona__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.preset-persona__body{display:flex;flex-direction:column;gap:12px;padding:12px 0 4px}
.preset-persona__field{display:flex;flex-direction:column;gap:6px}
.preset-persona__label{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500}
.preset-persona__hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.55;margin:0}
.preset-persona__input,.preset-persona__textarea{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;width:100%;box-sizing:border-box}
.preset-persona__input:focus-visible,.preset-persona__textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.preset-persona__textarea{font-family:${MONO};font-size:12px;line-height:1.6;resize:vertical;min-height:92px}
.preset-persona__check{display:flex;gap:8px;align-items:flex-start}
.preset-persona__check input{margin:2px 0 0;flex:none}
.preset-persona__check-text{display:flex;flex-direction:column;gap:3px}
.preset-persona__warn{color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5;margin:0}
.preset-persona__error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.55;margin:0}
.preset-persona__ok{color:var(--dsw-alias-state-success-primary);font-size:12px;margin:0}
.preset-persona__actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.preset-persona__button{appearance:none;font:inherit;font-size:13px;line-height:1.4;border-radius:8px;padding:6px 12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary)}
.preset-persona__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.preset-persona__button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.preset-persona__button:disabled{opacity:.5;cursor:default}
.preset-persona__button--primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.preset-persona__button--primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.preset-persona__meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;display:flex;flex-direction:column;gap:2px}
.preset-persona__path{margin:0}
.preset-persona__path code,.preset-persona__code{font-family:${MONO}}
.preset-persona__path code{word-break:break-all;background:var(--dsw-alias-markdown-inline-code);border-radius:4px;padding:1px 5px}
.preset-persona__pre{margin:0;padding:10px;background:var(--dsw-alias-markdown-code-block);border-radius:8px;font-family:${MONO};font-size:12px;line-height:1.6;overflow:auto;max-height:280px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}
.preset-persona__section{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px;display:flex;flex-direction:column;gap:8px}
.preset-persona__section-title{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;text-transform:none;margin:0}
.preset-persona__outline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:12px}
.preset-persona__outline-row{display:flex;gap:8px;align-items:baseline}
.preset-persona__order{font-family:${MONO};color:var(--dsw-alias-label-tertiary);flex:none;min-width:58px;text-align:right}
.preset-persona__outline-row--muted .preset-persona__outline-text{color:var(--dsw-alias-label-tertiary)}
.preset-persona__outline-row--active .preset-persona__outline-text{color:var(--dsw-alias-label-primary)}
.preset-persona__details{margin:0}
.preset-persona__details summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}
.preset-persona__details[open] summary{margin-bottom:8px}
.preset-persona__row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
.preset-persona__row .preset-persona__field{flex:1 1 160px}
.preset-persona__row .preset-persona__field--tight{flex:0 1 140px}
.preset-persona__section-row{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.preset-persona__section-row .preset-persona__check{align-items:center}
.preset-persona__section-row .preset-persona__check input{margin-top:0}
`;

/** The full stylesheet: canonical shell first, page body after. */
export const styles = `${PLUGIN_CARD_SHELL_CSS}\n${BODY}`;
