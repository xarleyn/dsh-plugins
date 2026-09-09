export const QA_SURFACE_STYLES = String.raw`
.dsh-qa-surface{position:fixed;inset:0;z-index:2147483000;pointer-events:auto;display:flex;flex-direction:column;min-width:0;height:100vh;height:100dvh;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit}
.dsh-qa-surface *{box-sizing:border-box}
.dsh-qa-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.dsh-qa-header{position:relative;flex:none;background:var(--dsw-alias-bg-base)}
.dsh-qa-header::after{content:"";position:absolute;right:0;bottom:1px;left:0;height:1px;background:var(--dsw-alias-border-l2);pointer-events:none}
.dsh-qa-header__inner{width:100%;padding:11px 28px 0 30px}
.dsh-qa-header__title-row{display:flex;align-items:center;min-height:32px;gap:10px}
.dsh-qa-header__logo{width:24px;height:24px;object-fit:contain;border-radius:6px;flex:none}
.dsh-qa-header h1{max-width:min(42vw,420px);min-width:0;overflow:hidden;margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-header__mode{display:inline-flex;align-items:center;gap:5px;flex:none;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;white-space:nowrap}
.dsh-qa-header__mode svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-header__reset{margin-left:auto;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dsh-qa-header__reset:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-header__reset:disabled{opacity:.45;cursor:default}
.dsh-qa-header__tabs{position:relative;z-index:1;display:flex;gap:32px;margin-top:4px}
.dsh-qa-header__tabs span{position:relative;padding:0 0 11px;color:var(--dsw-alias-state-business-primary);font-size:13px;font-weight:500;line-height:16px}
.dsh-qa-header__tabs span::after{content:"";position:absolute;right:0;bottom:1px;left:0;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}
.dsh-qa-transcript{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.dsh-qa-transcript__inner{width:100%;min-height:100%;margin:0 auto;padding:18px 16px 42px}
.dsh-qa-welcome{min-height:calc(100% - 40px);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:48px 0 88px}
.dsh-qa-welcome h2{max-width:620px;margin:0;color:var(--dsw-alias-label-primary);font-size:clamp(25px,4vw,34px);font-weight:600;line-height:1.24;letter-spacing:-.02em}
.dsh-qa-welcome p{max-width:520px;margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:21px}
.dsh-qa-suggestions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:24px}
.dsh-qa-suggestions button{max-width:360px;padding:9px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1.35;cursor:pointer}
.dsh-qa-suggestions button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-suggestions button:disabled{opacity:.5;cursor:default}
.dsh-qa-message{display:flex;flex-direction:column;width:100%;min-width:0;margin:0 0 20px}
.dsh-qa-message--user{align-items:flex-end;margin-left:auto}
.dsh-qa-message--assistant{align-items:flex-start;margin-right:auto}
.dsh-qa-message--work{align-items:flex-start;margin:-4px 0 14px}
.dsh-qa-message--system{align-items:center;margin:4px auto 20px}
.dsh-qa-message__content{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.62}
.dsh-qa-message--user .dsh-qa-message__content{max-width:min(525px,82%);padding:10px 16px;border-radius:22px;background:var(--dsw-specific-bubble);font-size:16px;line-height:24px}
.dsh-qa-message--assistant .dsh-qa-message__content{width:100%;padding:2px 0}
.dsh-qa-message--system .dsh-qa-message__content{padding:7px 11px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-qa-message[data-status="error"] .dsh-qa-message__content{color:var(--dsw-alias-state-error-primary)}
.dsh-qa-message__actions{display:flex;align-items:center;gap:8px;height:28px;margin-top:6px;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-message--user .dsh-qa-message__actions{justify-content:flex-end}
.dsh-qa-message__actions button{display:grid;place-items:center;width:28px;height:28px;padding:5px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-message__actions button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsh-qa-message__actions button:focus-visible{outline:2px solid var(--dsw-alias-button-info-fill);outline-offset:1px}
.dsh-qa-message__actions svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-message__actions time{padding:0 8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}
.dsh-qa-message__content p,.dsh-qa-message__content ul,.dsh-qa-message__content blockquote,.dsh-qa-message__content pre{margin:0 0 14px}
.dsh-qa-message__content :last-child{margin-bottom:0}
.dsh-qa-message__content h2,.dsh-qa-message__content h3,.dsh-qa-message__content h4{margin:18px 0 8px;line-height:1.35}
.dsh-qa-message__content h2{font-size:19px}.dsh-qa-message__content h3{font-size:17px}.dsh-qa-message__content h4{font-size:15px}
.dsh-qa-message__content ul{padding-left:22px}.dsh-qa-message__content a{color:var(--dsw-alias-state-business-primary)}
.dsh-qa-message__content code{border-radius:5px;padding:1px 4px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
.dsh-qa-message__content pre{overflow-x:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:13px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-message__content pre code{padding:0;background:transparent}
.dsh-qa-message__content blockquote{border-left:3px solid var(--dsw-alias-border-l2);padding-left:12px;color:var(--dsw-alias-label-secondary)}
.dsh-qa-message__cursor{display:inline-block;width:7px;height:1em;margin-left:3px;vertical-align:-2px;background:var(--dsw-alias-label-secondary);animation:dsh-qa-blink 1s steps(2,start) infinite}
@keyframes dsh-qa-blink{50%{opacity:0}}
.dsh-qa-work{width:100%;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.dsh-qa-work__toggle{display:flex;align-items:center;gap:7px;min-height:30px;margin:0;padding:3px 5px 3px 0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dsh-qa-work__toggle:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-work__toggle:focus-visible{outline:2px solid var(--dsw-alias-button-info-fill);outline-offset:2px}
.dsh-qa-work__chevron{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round;transition:transform .16s ease}
.dsh-qa-work__chevron[data-open],.dsh-qa-work-tool[open]>.dsh-qa-work-item .dsh-qa-work__chevron{transform:rotate(90deg)}
.dsh-qa-work__spinner,.dsh-qa-work-item__spinner{width:13px;height:13px;flex:none;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:dsh-qa-spin .9s linear infinite}
@keyframes dsh-qa-spin{to{transform:rotate(360deg)}}
.dsh-qa-work__body{position:relative;margin:4px 0 2px 6px;padding:3px 0 5px 18px;border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-work-item{min-width:0;color:var(--dsw-alias-label-secondary)}
.dsh-qa-work-item--tool{display:flex;align-items:center;gap:7px;min-height:32px;padding:4px 6px;border-radius:7px}
.dsh-qa-work-tool>summary{list-style:none;cursor:pointer}
.dsh-qa-work-tool>summary::-webkit-details-marker{display:none}
.dsh-qa-work-tool>summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-work-tool>summary:focus-visible{outline:2px solid var(--dsw-alias-button-info-fill);outline-offset:-1px}
.dsh-qa-work-item__icon{display:grid;place-items:center;width:16px;height:16px;flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-work-item__icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-work-item__icon[data-state="ok"]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary))}
.dsh-qa-work-item__icon[data-state="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-qa-work-item__label{flex:none;color:var(--dsw-alias-label-secondary);font-weight:500}
.dsh-qa-work-item__summary{min-width:0;overflow:hidden;flex:1;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-work-item--text{padding:5px 6px 9px}
.dsh-qa-work-item__text-head{display:flex;align-items:center;gap:7px;min-height:24px}
.dsh-qa-work-item__text{padding:3px 0 0 23px;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:23px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-work-item__text p,.dsh-qa-work-item__text ul,.dsh-qa-work-item__text pre{margin:0 0 9px}
.dsh-qa-work-item__text :last-child{margin-bottom:0}
.dsh-qa-work-tool__body{margin:0 6px 7px 29px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-work-tool__body section+section{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-work-tool__body section>span{display:block;padding:7px 10px 0;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:18px;text-transform:uppercase;letter-spacing:.04em}
.dsh-qa-work-tool__body pre{max-height:260px;overflow:auto;margin:0;padding:7px 10px 10px;color:var(--dsw-alias-label-secondary);background:transparent;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:19px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-error{display:flex;align-items:center;justify-content:center;gap:10px;margin:16px auto;padding:10px 12px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-qa-error button{border:0;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-weight:600;cursor:pointer}
.dsh-qa-footer{position:relative;flex:none;padding:28px 16px max(12px,env(safe-area-inset-bottom));background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-base) 0%,transparent) 0,var(--dsw-alias-bg-base) 28px)}
.dsh-qa-footer__inner{width:100%;margin:0 auto}
.dsh-qa-composer{display:flex;flex-direction:column;gap:10px;width:100%;min-height:94px;padding:14px 10px 8px 16px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);border-radius:22px;background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);transition:border-color .12s,box-shadow .12s}
.dsh-qa-composer:focus-within{border-color:var(--dsw-alias-label-caption)}
.dsh-qa-composer textarea{display:block;width:100%;min-height:28px;max-height:168px;resize:none;overflow-y:auto;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:16px;line-height:24px;padding:0 6px 0 0;caret-color:var(--dsw-alias-state-business-primary)}
.dsh-qa-composer textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-composer textarea:disabled{cursor:default}
.dsh-qa-composer__toolbar{display:flex;align-items:center;min-height:34px;gap:12px}
.dsh-qa-composer__hint{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-caption);font-size:11px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-composer__action{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:0;border-radius:999px;color:#fff;cursor:pointer}
.dsh-qa-composer__action svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-composer__action--send{background:var(--dsw-alias-button-info-fill)}
.dsh-qa-composer__action--send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
.dsh-qa-composer__action--stop{background:var(--dsw-alias-state-error-primary)}
.dsh-qa-composer__action--stop svg{fill:currentColor;stroke:none}
.dsh-qa-composer__action:disabled{opacity:.4;cursor:default}
.dsh-qa-composer__action:focus-visible,.dsh-qa-suggestions button:focus-visible,.dsh-qa-error button:focus-visible,.dsh-qa-header__reset:focus-visible{outline:2px solid var(--dsw-alias-button-info-fill);outline-offset:2px}
@media (hover:hover){.dsh-qa-message__actions time{opacity:0;transition:opacity 80ms ease}.dsh-qa-message:hover .dsh-qa-message__actions time,.dsh-qa-message:focus-within .dsh-qa-message__actions time{opacity:1}}
@media (max-width:600px){.dsh-qa-header__inner{padding-left:16px;padding-right:16px}.dsh-qa-header h1{max-width:48vw}.dsh-qa-header__mode{font-size:12px}.dsh-qa-transcript__inner{padding:16px 16px 28px}.dsh-qa-message{margin-bottom:16px}.dsh-qa-message--user .dsh-qa-message__content{max-width:88%;font-size:15px}.dsh-qa-message__content{font-size:14px}.dsh-qa-footer{padding-left:10px;padding-right:10px;padding-bottom:max(8px,env(safe-area-inset-bottom))}.dsh-qa-composer{min-height:84px;padding-top:12px}.dsh-qa-composer__hint{font-size:0}.dsh-qa-composer__hint::after{content:"Enter to send";font-size:11px}}
@media (max-height:480px) and (orientation:landscape){.dsh-qa-header__inner{padding-top:6px}.dsh-qa-header__tabs{display:none}.dsh-qa-transcript__inner{padding-top:12px}.dsh-qa-footer{padding-top:12px}.dsh-qa-composer{min-height:72px;gap:4px;padding-top:8px}}
@media (prefers-reduced-motion:reduce){.dsh-qa-message__cursor,.dsh-qa-work__spinner,.dsh-qa-work-item__spinner{animation:none}.dsh-qa-work__chevron{transition:none}}
`;
