export const QA_SURFACE_STYLES = String.raw`
.dsh-qa-surface{position:fixed;inset:0;z-index:2147483000;pointer-events:auto;display:flex;flex-direction:column;min-width:0;height:100vh;height:100dvh;overflow:hidden;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit}
.dsh-qa-surface *{box-sizing:border-box}
.dsh-qa-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.dsh-qa-header{flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-header__inner,.dsh-qa-footer__inner,.dsh-qa-transcript__inner{width:100%;margin:0 auto}
.dsh-qa-header__inner{min-height:72px;display:flex;align-items:center;gap:12px;padding:12px 24px}
.dsh-qa-header__logo{width:36px;height:36px;object-fit:contain;border-radius:9px;flex:none}
.dsh-qa-header__text{flex:1;min-width:0}
.dsh-qa-header h1{margin:0;color:var(--dsw-alias-label-primary);font-size:17px;font-weight:650;line-height:1.35}
.dsh-qa-header p{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.4}
.dsh-qa-transcript{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.dsh-qa-transcript__inner{min-height:100%;padding:32px 24px 24px}
.dsh-qa-welcome{min-height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:40px 0}
.dsh-qa-welcome h2{max-width:620px;margin:0;color:var(--dsw-alias-label-primary);font-size:clamp(24px,4vw,34px);font-weight:600;line-height:1.25}
.dsh-qa-suggestions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:24px}
.dsh-qa-suggestions button{max-width:360px;padding:9px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1.35;cursor:pointer}
.dsh-qa-suggestions button:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.dsh-qa-suggestions button:disabled{opacity:.5;cursor:default}
.dsh-qa-message{display:flex;flex-direction:column;max-width:min(82%,720px);margin:0 0 24px}
.dsh-qa-message--user{align-items:flex-end;margin-left:auto}
.dsh-qa-message--assistant{align-items:flex-start;margin-right:auto}
.dsh-qa-message--system{align-items:center;max-width:100%;margin-left:auto;margin-right:auto}
.dsh-qa-message__meta{display:flex;gap:8px;margin:0 4px 6px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:1.3}
.dsh-qa-message__content{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:11px 14px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.62}
.dsh-qa-message--user .dsh-qa-message__content{background:var(--dsw-alias-bg-module-platform)}
.dsh-qa-message--system .dsh-qa-message__content{padding:7px 11px;border-radius:9px;color:var(--dsw-alias-label-secondary);font-size:13px}
.dsh-qa-message[data-status="error"] .dsh-qa-message__content{border-color:var(--dsw-alias-status-error)}
.dsh-qa-message__content p,.dsh-qa-message__content ul,.dsh-qa-message__content blockquote,.dsh-qa-message__content pre{margin:0 0 10px}
.dsh-qa-message__content :last-child{margin-bottom:0}
.dsh-qa-message__content h2,.dsh-qa-message__content h3,.dsh-qa-message__content h4{margin:14px 0 7px;line-height:1.35}
.dsh-qa-message__content h2{font-size:18px}.dsh-qa-message__content h3{font-size:16px}.dsh-qa-message__content h4{font-size:15px}
.dsh-qa-message__content ul{padding-left:22px}.dsh-qa-message__content a{color:var(--dsw-alias-brand-primary)}
.dsh-qa-message__content code{border-radius:5px;padding:1px 4px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
.dsh-qa-message__content pre{overflow-x:auto;border-radius:9px;padding:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-message__content pre code{padding:0;background:transparent}
.dsh-qa-message__content blockquote{border-left:3px solid var(--dsw-alias-border-l2);padding-left:12px;color:var(--dsw-alias-label-secondary)}
.dsh-qa-message__cursor{display:inline-block;width:7px;height:1em;margin-left:3px;vertical-align:-2px;background:var(--dsw-alias-label-secondary);animation:dsh-qa-blink 1s steps(2,start) infinite}
@keyframes dsh-qa-blink{50%{opacity:0}}
.dsh-qa-error{display:flex;align-items:center;justify-content:center;gap:10px;margin:16px auto;padding:10px 12px;border:1px solid var(--dsw-alias-status-error);border-radius:10px;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-qa-error button{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-weight:600;cursor:pointer}
.dsh-qa-footer{flex:none;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:0 24px max(14px,env(safe-area-inset-bottom))}
.dsh-qa-footer__inner{position:relative;padding-top:14px}
.dsh-qa-status{min-height:18px;margin-bottom:5px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-qa-composer{display:flex;align-items:flex-end;gap:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:7px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s}
.dsh-qa-composer:focus-within{border-color:var(--dsw-alias-brand-primary)}
.dsh-qa-composer textarea{flex:1;min-width:0;max-height:160px;resize:none;overflow-y:auto;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:15px;line-height:22px;padding:7px 9px}
.dsh-qa-composer textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-button{appearance:none;flex:none;border:1px solid transparent;border-radius:9px;padding:8px 13px;font:inherit;font-size:13px;font-weight:600;line-height:18px;cursor:pointer}
.dsh-qa-button:focus-visible,.dsh-qa-suggestions button:focus-visible,.dsh-qa-error button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-qa-button:disabled{opacity:.45;cursor:default}
.dsh-qa-button--send{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-primary)}
.dsh-qa-button--stop,.dsh-qa-button--secondary{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
@media (max-width:600px){.dsh-qa-header__inner{min-height:60px;padding:9px 14px}.dsh-qa-header__logo{width:32px;height:32px}.dsh-qa-header p{display:none}.dsh-qa-transcript__inner{padding:22px 14px 16px}.dsh-qa-message{max-width:90%;margin-bottom:18px}.dsh-qa-message__content{font-size:14px;padding:10px 12px}.dsh-qa-footer{padding-left:10px;padding-right:10px}.dsh-qa-button{padding-left:11px;padding-right:11px}}
@media (max-height:480px) and (orientation:landscape){.dsh-qa-header__inner{min-height:48px;padding-top:6px;padding-bottom:6px}.dsh-qa-header p{display:none}.dsh-qa-transcript__inner{padding-top:14px}.dsh-qa-footer__inner{padding-top:7px}.dsh-qa-status{position:absolute;right:0;top:-18px}}
@media (prefers-reduced-motion:reduce){.dsh-qa-message__cursor{animation:none}}
`;
