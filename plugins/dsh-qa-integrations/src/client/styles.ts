/**
 * The bundle stylesheet.
 *
 * Two kinds of rule live here and both are this plugin's own copy on purpose.
 *
 * The credential-help note's rules are this bundle's copy of the block
 * `@yadsh/dsh-plugin-kit` ships for a card that owns its shell, retargeted ring by
 * ring rather than dropped in as it stands: on the Plugins panel a hard-coded
 * outline loses to the Host's focus.css under pointer modality (specificity 0-3-2
 * against 0-2-0). The block is renamed to `dsh-qa-integrations-help*` for the same
 * reason the rings are retargeted — the kit's `.dsh-credential-help*` selectors are
 * public, so a copy wearing them would inject rules that fight the kit's own sheet
 * for the same elements at equal specificity, settled only by the order two
 * bundles happen to append their `<style>` tags. This is the sheet the note
 * component in credential-help-note.tsx dresses; what the note *says* stays the
 * kit's (`credentialHelpView`), and a test keeps the two renderings equal in
 * content.
 *
 * The card shell is not here at all: on the row and bundle seats the page draws
 * the frame, the title and the expand control, so a shell class or a 12 px radius
 * of ours would be a second card inside the Host's one
 * (AGENTS.md, "Two kinds of card: who owns the chrome").
 *
 * Every ring below is the Host's token pair written out in full, with a fallback
 * on each half — the width as well as the colour, because a var() that resolves
 * to nothing invalidates the whole outline shorthand and the ring disappears
 * instead of degrading. Nothing here raises specificity to win a ring fight; the
 * Host keeps that, and scripts/verify-package.mjs reads these declarations the
 * way the card-contract gate does, so the value stays a literal in one string.
 */
export const styles: string = String.raw`.dsh-qa-integrations-help{margin:0;font-size:12px;line-height:1.55;display:flex;flex-direction:column;gap:8px}
.dsh-qa-integrations-help__trigger{appearance:none;width:fit-content;padding:0;border:0;background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:1.55;text-align:left;text-decoration:underline;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.dsh-qa-integrations-help__trigger:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:4px}
.dsh-qa-integrations-help__chevron{width:7px;height:7px;flex:none;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .16s}
.dsh-qa-integrations-help__trigger[aria-expanded="true"] .dsh-qa-integrations-help__chevron{transform:rotate(45deg)}
.dsh-qa-integrations-help__panel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-secondary)}
.dsh-qa-integrations-help__title{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
.dsh-qa-integrations-help__text{margin:0}
.dsh-qa-integrations-help__steps,.dsh-qa-integrations-help__list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.dsh-qa-integrations-help__steps{list-style:decimal}
.dsh-qa-integrations-help__group{display:flex;flex-direction:column;gap:5px}
.dsh-qa-integrations-help__label{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600}
.dsh-qa-integrations-help__links{display:flex;flex-wrap:wrap;gap:12px}
.dsh-qa-integrations-help__links a,.dsh-qa-integrations-help__link{color:var(--dsw-alias-brand-primary);text-decoration:underline}
.dsh-qa-integrations-help__links a:focus-visible,.dsh-qa-integrations-help__link:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:4px}
.dsh-qa-integrations__body{display:flex;flex-direction:column;gap:16px}
.dsh-qa-integrations__body-title{margin:0;font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-qa-integrations{display:flex;flex-direction:column;gap:20px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsh-qa-integrations__heading{margin:0;font-size:22px;line-height:1.3}
.dsh-qa-integrations__lead,.dsh-qa-integrations__hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}
.dsh-qa-integrations__card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:16px}
.dsh-qa-integrations__card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.dsh-qa-integrations__provider{margin:0;font-size:17px;line-height:1.4}
.dsh-qa-integrations__portal{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-integrations__status{border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);padding:2px 9px;font-size:11px;white-space:nowrap}
.dsh-qa-integrations__status--ok{color:var(--dsw-alias-state-success-primary)}
.dsh-qa-integrations__field{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:600}
.dsh-qa-integrations__input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:9px 11px;font:inherit}
.dsh-qa-integrations__actions{display:flex;flex-wrap:wrap;gap:8px}
.dsh-qa-integrations__button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer}
.dsh-qa-integrations__button--primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-qa-integrations__button--danger{color:var(--dsw-alias-state-error-primary)}
.dsh-qa-integrations__button:disabled,.dsh-qa-integrations__input:disabled{cursor:not-allowed;opacity:.55}
.dsh-qa-integrations__input:focus-visible,.dsh-qa-integrations__button:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-qa-integrations__section{display:flex;flex-direction:column;gap:10px}
.dsh-qa-integrations__section h4{margin:0;font-size:14px}
.dsh-qa-integrations__permission{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}
.dsh-qa-integrations__permission label{display:flex;align-items:center;gap:8px}
.dsh-qa-integrations__muted{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-integrations__error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:9px 11px;color:var(--dsw-alias-state-error-primary);font-size:13px}
.dsh-qa-integrations__notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:12px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.dsh-qa-integrations__check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.dsh-qa-integrations__check input:focus-visible,.dsh-qa-integrations__permission input:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-qa-integrations__hint code{background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:0 4px;font-size:12px}
.qai-op__body{display:flex;flex-direction:column;gap:14px}
.qai-op__muted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.qai-op__error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:9px 11px;color:var(--dsw-alias-state-error-primary);font-size:13px}
.qai-op__toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.qai-op__override-state{border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.qai-op__section{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.qai-op__section-summary{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;list-style:none;user-select:none}
.qai-op__section-summary::-webkit-details-marker{display:none}
.qai-op__section-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.qai-op__section-summary::before{content:"";width:8px;height:8px;flex:none;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:rotate(-45deg);transition:transform .16s}
.qai-op__section[open]>.qai-op__section-summary::before{transform:rotate(45deg)}
.qai-op__section-body{display:flex;flex-direction:column;gap:12px;padding:2px 14px 14px;border-top:1px solid var(--dsw-alias-border-l2)}
.qai-op__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px 18px}
.qai-op__section-state{margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qai-op__group{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}
.qai-op__section-body>.qai-op__group:first-child{padding-top:0;border-top:0}
.qai-op__group-title{margin:0;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
.qai-op__group-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.45}
.qai-op__group--wide>.qai-op__grid{grid-template-columns:minmax(0,1fr)}
.qai-op__group--checks>.qai-op__grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:2px 18px}
.qai-op__group--checks .qai-op__toggle-row{flex-direction:row-reverse;justify-content:flex-end;align-items:center;gap:9px;padding:3px 0;text-align:left}
.qai-op__group--checks .qai-op__toggle-copy span{padding-left:25px}
.qai-op__group--limits{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}
.qai-op__group-summary{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;cursor:pointer;list-style:none;user-select:none}
.qai-op__group-summary::-webkit-details-marker{display:none}
.qai-op__group-summary::before{content:"";width:6px;height:6px;flex:none;align-self:center;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:rotate(-45deg);transition:transform .16s}
.qai-op__group--limits[open]>.qai-op__group-summary::before{transform:rotate(45deg)}
.qai-op__group--limits>.qai-op__grid{padding-top:10px}
.qai-op__field{display:flex;flex-direction:column;gap:6px;font-size:13px;min-width:0}
.qai-op__label{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--dsw-alias-label-primary);font-size:12.5px}
.qai-op__hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.45;font-weight:400}
.qai-op__overridden{border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);padding:0 7px;font-size:10.5px;font-weight:500;white-space:nowrap}
.qai-op__input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;width:100%;min-width:0;box-sizing:border-box}
.qai-op__button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 12px;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.qai-op__button:disabled{cursor:not-allowed;opacity:.55}
.qai-op__input:focus-visible,.qai-op__button:focus-visible,.qai-op__row-remove:focus-visible,.qai-op__toggle:focus-visible,.qai-op__section-summary:focus-visible,.qai-op__group-summary:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:1px}
.qai-op__toggle-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;font-size:12.5px;padding:4px 0}
.qai-op__toggle-row--inline{align-items:center;padding:0}
.qai-op__toggle-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.qai-op__toggle-copy strong{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--dsw-alias-label-primary)}
.qai-op__toggle-copy span{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.45}
.qai-op__toggle{width:16px;height:16px;flex:none;accent-color:var(--dsw-alias-brand-primary);margin-top:2px}
.qai-op__rows{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.qai-op__row{display:flex;align-items:center;gap:8px;font-size:12.5px}
.qai-op__row-key{color:var(--dsw-alias-label-secondary);font-size:12px;flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qai-op__row-value{color:var(--dsw-alias-label-primary);font-size:12.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qai-op__row-add{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.qai-op__row-add .qai-op__input{width:auto;flex:1;min-width:120px}
.qai-op__row-remove{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11.5px;cursor:pointer;padding:2px 4px;flex:none}
.qai-op__row-remove:hover{color:var(--dsw-alias-state-error-primary)}
.qai-op__instances,.qai-op__profiles{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.qai-op__instance,.qai-op__profile{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);padding:10px;display:flex;flex-direction:column;gap:8px}
.qai-op__instance{flex-direction:row;align-items:flex-end;flex-wrap:wrap}
.qai-op__instance-cell{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex:1;min-width:110px}
.qai-op__instance-cell--wide{flex:2}
.qai-op__instance-key{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.qai-op__profile-head{display:flex;align-items:center;gap:10px}
.qai-op__profile-head strong{font-size:13px;color:var(--dsw-alias-label-primary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qai-op__profile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px 12px}
`;
