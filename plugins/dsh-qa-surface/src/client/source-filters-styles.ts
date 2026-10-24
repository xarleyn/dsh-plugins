export const sourceFiltersStyles = `
.dsh-qa-sourcefilters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:2px 12px 10px;flex:none}
.dsh-qa-sourcefilters input,.dsh-qa-sourcefilters select{min-width:0;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.dsh-qa-sourcefilters input{flex:1 1 200px;width:100%}
.dsh-qa-sourcefilters select{flex:1 1 150px;max-width:100%}
.dsh-qa-sourcefilters__count{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-sourcefilters button{margin-left:auto;border:0;background:transparent;color:var(--dsh-qa-accent);font:inherit;font-size:12px;cursor:pointer}
.dsh-qa-sourcefilters :is(input,select,button):focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsh-qa-accent));outline-offset:2px}
.dsh-qa-sourcedetail__content-label{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
`;
