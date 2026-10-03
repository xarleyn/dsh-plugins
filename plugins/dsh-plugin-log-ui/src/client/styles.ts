/**
 * Card stylesheet: the body rules of the settings card.
 *
 * The frame is not here, because it is not ours: this card is seated on the Plugins
 * panel row, where the page draws the surface, the heading and the expand control
 * (AGENTS.md, decision D1 of §10 of `docs/DSH-0.1.7-MIGRATION.md`). Surfaces, borders
 * and ink come from `--dsw-alias-*` tokens so light, dark and system themes stay
 * coherent, and the focus ring is the Host's own token pair rather than a hard-coded
 * outline — `focus.css` of the Host wins that fight on specificity (0-3-2 against
 * 0-2-0) under pointer modality, so raising our specificity is the wrong repair. Both
 * halves of the pair carry a fallback: where a token is undeclared, the whole
 * `outline` shorthand is dropped and the ring disappears rather than degrading.
 */
export const styles = `.plu-body{padding-top:16px;display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary)}
.plu-section{display:flex;flex-direction:column;gap:10px}.plu-section h3{margin:0;font-size:13px;color:var(--dsw-alias-label-primary)}
.plu-count{margin-left:8px;font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary)}
.plu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.plu-field{display:flex;flex-direction:column;gap:6px}.plu-field>span{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.plu-select{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.plu-select:focus-visible{border-color:var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:-1px}
.plu-select:disabled{opacity:.55}
.plu-hint,.plu-status,.plu-empty{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.plu-error{margin:0;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error);font-size:12px}
.plu-list{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}.plu-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(150px,220px);gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.plu-plugin{min-width:0}.plu-plugin code{display:block;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--dsw-alias-label-primary)}.plu-plugin span{display:block;margin-top:3px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
@media(max-width:720px){.plu-grid{grid-template-columns:1fr}.plu-row{grid-template-columns:1fr}}
`;
