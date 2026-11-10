/** Virtual history controls inherit the same palette as the existing sidebar. */
export const historyOrganizationStyles = String.raw`
.dsh-qa-history__create,.dsh-qa-history__title,.dsh-qa-history__edit{appearance:none;font:inherit;color:var(--dsw-alias-label-secondary);border:0;background:transparent;cursor:pointer;border-radius:8px;font-size:12px;line-height:16px}
.dsh-qa-history__create{display:block;width:100%;text-align:left;padding:8px 12px;margin-bottom:8px}
.dsh-qa-history__heading{display:flex;align-items:center;gap:4px;min-width:0;padding:4px}
.dsh-qa-history__heading[draggable=true]{cursor:grab}
.dsh-qa-history__title{display:flex;align-items:center;gap:8px;flex:1;min-width:0;text-align:left;padding:4px;font-weight:600}
.dsh-qa-history__title>span:first-of-type{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.dsh-qa-history__title>span:last-child{color:var(--dsw-alias-label-tertiary);font-weight:400}
.dsh-qa-history__title svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}
.dsh-qa-history__edit{padding:4px 8px;flex:none}
.dsh-qa-history__edit svg{display:block;width:16px;height:16px;fill:currentColor}
.dsh-qa-history__create:hover,.dsh-qa-history__title:is(button):hover,.dsh-qa-history__edit:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-qa-history__create:focus-visible,.dsh-qa-history__title:focus-visible,.dsh-qa-history__edit:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsh-qa-accent));outline-offset:-2px}
.dsh-qa-history__section{position:relative;border-radius:8px;margin-bottom:8px;min-height:32px}
.dsh-qa-history__section[data-drop=inside]{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-history__row{border-radius:8px;position:relative}
.dsh-qa-history__row[data-drop]::before,.dsh-qa-history__section[data-drop=before]::before,.dsh-qa-history__section[data-drop=after]::before{content:"";position:absolute;left:4px;right:4px;top:0;height:2px;background:var(--dsh-qa-accent);z-index:1}
.dsh-qa-history__row[data-drop=after]::before,.dsh-qa-history__section[data-drop=after]::before{top:auto;bottom:0}
.dsh-qa-history__row[draggable=true]{cursor:grab}
.dsh-qa-history__hint{margin:0;padding:4px 8px 8px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);text-wrap:pretty}
.dsh-qa-history__order{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.dsh-qa-history__pin{display:inline-block;vertical-align:middle;width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;margin-right:4px;color:var(--dsw-alias-label-secondary)}
.dsh-qa-history__announcement{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.dsh-qa-history .dsh-qa-sidebar__item-main{width:auto;flex:1}
.dsh-qa-history .dsh-qa-chat-actions,.dsh-qa-history .dsh-qa-sidebar__item-delete{position:static;transform:none;flex:none}
.dsh-qa-history .dsh-qa-sidebar__item-audit--with-delete{margin-right:4px}
.dsh-qa-chat-actions__menu{max-height:calc(100dvh - 16px);overflow-y:auto}
@media(hover:none){.dsh-qa-chat-actions__trigger,.dsh-qa-sidebar__item-delete{opacity:1;pointer-events:auto}}
`;
