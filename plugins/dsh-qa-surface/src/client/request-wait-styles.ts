export const requestWaitStyles = `
.dsh-qa-request-wait{display:flex;align-items:center;gap:8px;align-self:flex-start;width:fit-content;max-width:100%;box-sizing:border-box;margin:0 0 10px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.45;overflow-wrap:anywhere}
.dsh-qa-request-wait__spinner{width:12px;height:12px;flex:none;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:dsh-qa-request-spin 1s linear infinite}
@keyframes dsh-qa-request-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dsh-qa-request-wait__spinner{animation:none}}
`;
