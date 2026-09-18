/**
 * The audit components' stylesheet.
 *
 * It is a string rather than a CSS file because the two consumers inject it in
 * different ways — a plugin client bundle appends a `<style>` tag, and the DSH
 * web build has no CSS-module story for third-party bundles — and because one
 * exported constant cannot drift between them.
 *
 * Every colour is a `--dsw-alias-*` theme token, so light, dark and system
 * themes stay coherent. The token list is not guessed: a constructor that does
 * not exist produces a dropped declaration and invisible text, so each name
 * here is one the theme actually defines.
 */
export const AUDIT_UI_STYLES = String.raw`
.dsh-audit-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.dsh-audit-badge__icon{width:12px;height:12px;color:var(--dsw-alias-state-success-primary);flex:none}
.dsh-audit-status{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.dsh-audit-status--compact{padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-audit-status__headline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-audit-status__verdict{font-size:17px;font-weight:600;line-height:1.3;color:var(--dsw-alias-label-primary)}
.dsh-audit-status__verdict--good{color:var(--dsw-alias-state-success-primary)}
.dsh-audit-status__verdict--warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-audit-status__verdict--bad{color:var(--dsw-alias-state-error-primary)}
.dsh-audit-status__verdict--neutral{color:var(--dsw-alias-label-secondary)}
.dsh-audit-status__chip{padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:17px}
.dsh-audit-status__chip--quiet{background:transparent;border:1px solid var(--dsw-alias-border-l2)}
.dsh-audit-status__findings{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-audit-status__findings--clean{color:var(--dsw-alias-state-success-primary)}
.dsh-audit-status__meta{display:flex;flex-wrap:wrap;gap:4px 20px;margin:0}
.dsh-audit-status__meta-pair{display:flex;gap:6px;font-size:12px;line-height:1.6;min-width:0}
.dsh-audit-status__meta-pair dt{color:var(--dsw-alias-label-tertiary);margin:0}
.dsh-audit-status__meta-pair dd{margin:0;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:22ch}
.dsh-audit-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-audit-tabs__tab{appearance:none;border:0;background:0 0;font:inherit;font-size:13px;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:10px 12px;border-bottom:2px solid transparent;transition:color .16s,border-color .16s}
.dsh-audit-tabs__tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-audit-tabs__tab--active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.dsh-audit-tabs__tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-audit-section{margin:0 0 20px}
.dsh-audit-section--quiet{margin-bottom:8px}
.dsh-audit-section__title{margin:0 0 10px;font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-empty{margin:0;padding:24px 16px;color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center}
.dsh-audit-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;min-height:160px;padding:32px 16px;text-align:center}
.dsh-audit-state__title{margin:0;font-size:14px;color:var(--dsw-alias-label-secondary)}
.dsh-audit-state__hint{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary);max-width:52ch}
.dsh-audit-state--error .dsh-audit-state__title{color:var(--dsw-alias-state-error-primary)}
.dsh-audit-state__action{margin-top:4px;padding:6px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dsh-audit-state__action:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-audit-scores{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.dsh-audit-scores__row{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}
.dsh-audit-scores__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dsh-audit-scores__name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-audit-scores__value{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);flex:none;font-variant-numeric:tabular-nums}
.dsh-audit-scores__value--0,.dsh-audit-scores__value--1{color:var(--dsw-alias-state-error-primary)}
.dsh-audit-scores__value--2{color:var(--dsw-alias-state-warn-primary)}
.dsh-audit-scores__value--3,.dsh-audit-scores__value--4{color:var(--dsw-alias-state-success-primary)}
.dsh-audit-scores__value--na{color:var(--dsw-alias-label-tertiary)}
.dsh-audit-scores__summary{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-audit-scores__foot{display:flex;gap:12px;margin-top:6px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-scores__evidence{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-audit-findings{display:flex;flex-direction:column;gap:20px}
.dsh-audit-findings__group-title{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-findings__group-count{padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;text-transform:none;letter-spacing:0}
.dsh-audit-finding{border:1px solid var(--dsw-alias-border-l2);border-left-width:3px;border-radius:10px;background:var(--dsw-alias-bg-layer-3);padding:12px 14px;margin-bottom:10px}
.dsh-audit-finding--critical,.dsh-audit-finding--major{border-left-color:var(--dsw-alias-state-error-primary)}
.dsh-audit-finding--minor{border-left-color:var(--dsw-alias-state-warn-primary)}
.dsh-audit-finding--observation{border-left-color:var(--dsw-alias-border-l3)}
.dsh-audit-finding--other{border-left-color:var(--dsw-alias-state-business-primary)}
.dsh-audit-finding__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-audit-finding__id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-finding__severity{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.dsh-audit-finding__severity--critical,.dsh-audit-finding__severity--major{color:var(--dsw-alias-state-error-primary)}
.dsh-audit-finding__severity--minor{color:var(--dsw-alias-state-warn-primary)}
.dsh-audit-finding__severity--observation{color:var(--dsw-alias-label-tertiary)}
.dsh-audit-finding__severity--other{color:var(--dsw-alias-state-business-primary)}
.dsh-audit-finding__category{padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px}
.dsh-audit-finding__status{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-finding__title{margin:8px 0 0;font-size:14px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-audit-finding__description{margin:6px 0 0;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}
.dsh-audit-finding__facts{display:flex;flex-wrap:wrap;gap:4px 20px;margin:10px 0 0}
.dsh-audit-finding__facts div{display:flex;gap:6px;font-size:12px;min-width:0}
.dsh-audit-finding__facts dt{color:var(--dsw-alias-label-tertiary);margin:0}
.dsh-audit-finding__facts dd{margin:0;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word}
.dsh-audit-recommendations{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.dsh-audit-recommendation{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}
.dsh-audit-recommendation__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-audit-recommendation__priority{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-recommendation__priority--high{color:var(--dsw-alias-state-error-primary)}
.dsh-audit-recommendation__priority--medium{color:var(--dsw-alias-state-warn-primary)}
.dsh-audit-recommendation__target{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-recommendation__action{margin:6px 0 0;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.dsh-audit-recommendation__evidence{margin:6px 0 0;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-steps,.dsh-audit-limitations{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.dsh-audit-opportunities{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.dsh-audit-opportunity{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}
.dsh-audit-opportunity__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dsh-audit-opportunity__capability{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-audit-opportunity__confidence{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}
.dsh-audit-opportunity__why{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-audit-opportunity__evidence{margin:6px 0 0;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-report{display:flex;flex-direction:column;gap:16px}
.dsh-audit-report__toc{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);padding:10px 14px}
.dsh-audit-report__toc ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.dsh-audit-report__toc li[data-depth="2"]{padding-left:12px}
.dsh-audit-report__toc li[data-depth="3"]{padding-left:24px}
.dsh-audit-report__toc a{font-size:13px;color:var(--dsw-alias-link);text-decoration:none}
.dsh-audit-report__toc a:hover{text-decoration:underline}
.dsh-audit-md{font-size:14px;line-height:1.65;color:var(--dsw-alias-label-primary);word-wrap:break-word}
.dsh-audit-md__p{margin:0 0 12px}
.dsh-audit-md__h1,.dsh-audit-md__h2,.dsh-audit-md__h3,.dsh-audit-md__h4,.dsh-audit-md__h5,.dsh-audit-md__h6{margin:24px 0 10px;line-height:1.35;font-weight:600;color:var(--dsw-alias-label-primary);scroll-margin-top:16px}
.dsh-audit-md__h1{font-size:22px}
.dsh-audit-md__h2{font-size:18px;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-audit-md__h3{font-size:15px}
.dsh-audit-md__h4,.dsh-audit-md__h5,.dsh-audit-md__h6{font-size:14px}
.dsh-audit-md__h1:first-child,.dsh-audit-md__h2:first-child,.dsh-audit-md__h3:first-child{margin-top:0}
.dsh-audit-md__list{margin:0 0 12px;padding-left:22px;display:flex;flex-direction:column;gap:4px}
.dsh-audit-md__li>*:last-child{margin-bottom:0}
.dsh-audit-md__li--task{list-style:none;display:flex;align-items:flex-start;gap:6px;margin-left:-18px}
.dsh-audit-md__task{margin:4px 0 0;flex:none}
.dsh-audit-md__quote{margin:0 0 12px;padding:2px 0 2px 14px;border-left:3px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.dsh-audit-md__quote p:last-child{margin-bottom:0}
.dsh-audit-md__code{padding:1px 5px;border-radius:5px;background:var(--dsw-alias-markdown-inline-code);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
.dsh-audit-md__pre{margin:0 0 12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-markdown-code-block);overflow-x:auto}
.dsh-audit-md__pre code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-primary);white-space:pre}
.dsh-audit-md__link{color:var(--dsw-alias-link);text-decoration:none}
.dsh-audit-md__link:hover{text-decoration:underline}
.dsh-audit-md__image{max-width:100%;height:auto;border-radius:8px}
.dsh-audit-md__rule{margin:20px 0;border:0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-audit-md__table-wrap{margin:0 0 14px;overflow-x:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.dsh-audit-md__table{border-collapse:collapse;width:100%;font-size:13px}
.dsh-audit-md__table th,.dsh-audit-md__table td{padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top;line-height:1.5}
.dsh-audit-md__table th{background:var(--dsw-alias-bg-layer-3);font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}
.dsh-audit-md__table td{color:var(--dsw-alias-label-secondary)}
.dsh-audit-md__table tr:last-child td{border-bottom:0}
.dsh-audit-json{display:flex;flex-direction:column;min-height:0;height:100%}
.dsh-audit-json__bar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap}
.dsh-audit-json__modes{display:flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.dsh-audit-json__mode{appearance:none;border:0;background:0 0;font:inherit;font-size:12px;padding:4px 12px;cursor:pointer;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-json__mode--active{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
.dsh-audit-json__mode:disabled{cursor:default;opacity:.5}
.dsh-audit-json__search{flex:1;min-width:140px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.dsh-audit-json__action{padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dsh-audit-json__action:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-audit-json__note{margin:0;padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-audit-json__tree{flex:1;min-height:0;overflow:auto;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.7}
.dsh-audit-json__children{padding-left:16px;border-left:1px solid var(--dsw-alias-border-l2);margin-left:6px}
.dsh-audit-json__row{display:flex;align-items:baseline;gap:4px;min-width:0}
.dsh-audit-json__toggle{appearance:none;border:0;background:0 0;padding:0;width:14px;flex:none;cursor:pointer;color:var(--dsw-alias-label-tertiary);line-height:1;display:inline-flex;align-items:center;justify-content:center}
.dsh-audit-json__chevron{width:12px;height:12px;flex:none;transition:transform .16s;transform:rotate(-90deg)}
.dsh-audit-json__chevron--open{transform:rotate(0deg)}
.dsh-audit-json__toggle:hover{color:var(--dsw-alias-label-primary)}
.dsh-audit-json__gutter{width:14px;flex:none}
.dsh-audit-json__key{appearance:none;border:0;background:0 0;padding:0;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.dsh-audit-json__key:hover{text-decoration:underline}
.dsh-audit-json__colon{color:var(--dsw-alias-label-tertiary)}
.dsh-audit-json__summary{color:var(--dsw-alias-label-tertiary)}
.dsh-audit-json__value{appearance:none;border:0;background:0 0;padding:0;font:inherit;cursor:pointer;text-align:left;word-break:break-all;color:var(--dsw-alias-label-secondary)}
.dsh-audit-json__value--string{color:var(--dsw-alias-state-success-primary)}
.dsh-audit-json__value--number{color:var(--dsw-alias-state-business-primary)}
.dsh-audit-json__value--boolean{color:var(--dsw-alias-state-warn-primary)}
.dsh-audit-json__value--null{color:var(--dsw-alias-label-tertiary)}
.dsh-audit-json__mark{background:var(--dsw-alias-interactive-bg-hover-accent);color:inherit;border-radius:3px}
.dsh-audit-json__raw{flex:1;min-height:0;margin:0;padding:12px 14px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-markdown-code-block);white-space:pre}
`;
