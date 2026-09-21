/**
 * The QA browser panel's chrome. Every color comes from the host's themed
 * aliases, so the panel follows light/dark with the rest of DSH. The layout is
 * a browser's: a tab strip, one bar carrying navigation and the address, an
 * optional device row, the page, and one status line for the lease.
 */
export const BROWSER_PANEL_STYLES = `
@keyframes dsh-qa-browser-spin{to{transform:rotate(360deg)}}
@keyframes dsh-qa-browser-slide{0%{transform:translateX(-40%)}100%{transform:translateX(240%)}}
.dsh-qa-browser-panel{height:100%;min-width:0;min-height:0;overflow:hidden;position:relative;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto auto auto;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-qa-browser-panel__tabs{display:flex;align-items:flex-end;gap:4px;min-height:38px;padding:6px 8px 0;overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);scrollbar-width:thin}
.dsh-qa-browser-panel__tab{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:88px;max-width:190px;padding:6px 6px 6px 10px;border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:default}
.dsh-qa-browser-panel__tab[aria-selected=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.dsh-qa-browser-panel__tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-qa-browser-panel__tab-icon{display:grid;place-items:center;width:14px;height:14px;flex:none}
.dsh-qa-browser-panel__tab-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-dimmed)}
.dsh-qa-browser-panel__tab-spinner{width:12px;height:12px;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:dsh-qa-browser-spin 800ms linear infinite}
.dsh-qa-browser-panel__tab-label{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.dsh-qa-browser-panel__tab-close{appearance:none;display:grid;place-items:center;flex:none;width:18px;height:18px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;transition:opacity 120ms ease}
.dsh-qa-browser-panel__tab:hover .dsh-qa-browser-panel__tab-close,.dsh-qa-browser-panel__tab[aria-selected=true] .dsh-qa-browser-panel__tab-close,.dsh-qa-browser-panel__tab-close:focus-visible{opacity:1}
.dsh-qa-browser-panel__tab-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-browser-panel__tab-close:disabled{cursor:default;opacity:0}
.dsh-qa-browser-panel__tab-close svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round}
.dsh-qa-browser-panel__newtab{appearance:none;display:grid;place-items:center;flex:none;width:26px;height:26px;margin:0 2px 4px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-qa-browser-panel__newtab:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-browser-panel__newtab:disabled{cursor:default;opacity:.4}
.dsh-qa-browser-panel__newtab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-qa-browser-panel__newtab svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round}
.dsh-qa-browser-panel__bar{position:relative;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-browser-panel__toolbar{display:flex;align-items:center;gap:6px;min-width:0;padding:8px}
.dsh-qa-browser-panel__nav,.dsh-qa-browser-panel__tool{appearance:none;display:grid;place-items:center;flex:none;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-qa-browser-panel__nav:hover:not(:disabled),.dsh-qa-browser-panel__tool:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-browser-panel__nav:disabled{cursor:default;opacity:.35}
.dsh-qa-browser-panel__tool--on{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.dsh-qa-browser-panel__nav:focus-visible,.dsh-qa-browser-panel__tool:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-qa-browser-panel__nav svg,.dsh-qa-browser-panel__tool svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-browser-panel__tool svg circle{fill:currentColor;stroke:none}
.dsh-qa-browser-panel__omni{display:flex;align-items:center;gap:6px;flex:1;min-width:0;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-browser-panel__omni:focus-within{border-color:var(--dsw-alias-brand-primary)}
.dsh-qa-browser-panel__address-icon{display:grid;place-items:center;flex:none;width:15px;height:15px;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-browser-panel__address-icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.1}
.dsh-qa-browser-panel__address{flex:1;min-width:0;height:100%;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:12px/18px ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis}
.dsh-qa-browser-panel__address:focus{outline:0;color:var(--dsw-alias-label-primary)}
.dsh-qa-browser-panel__address::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-browser-panel__device{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:0 8px 8px}
.dsh-qa-browser-panel__device-size{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-browser-panel__device-field{width:66px;height:26px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:12px/18px ui-monospace,SFMono-Regular,Consolas,monospace;text-align:center;appearance:textfield}
.dsh-qa-browser-panel__device-field::-webkit-outer-spin-button,.dsh-qa-browser-panel__device-field::-webkit-inner-spin-button{appearance:none;margin:0}
.dsh-qa-browser-panel__device-field:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-qa-browser-panel__device-field:disabled{opacity:.5}
.dsh-qa-browser-panel__device-pick select{height:26px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dsh-qa-browser-panel__device-pick select:disabled{cursor:default;opacity:.5}
.dsh-qa-browser-panel__device-pick select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-qa-browser-panel__stage{position:relative;display:grid;place-items:center;min-height:0;padding:14px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dsh-qa-browser-panel__stage:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-qa-browser-panel__canvas-scroll{display:grid;place-items:center;width:100%;height:100%;overflow:auto;scrollbar-width:thin}
.dsh-qa-browser-panel__canvas{position:relative;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);box-shadow:0 6px 18px rgba(0,0,0,.12)}
.dsh-qa-browser-panel__canvas--fit{display:grid;place-items:center;max-width:100%;max-height:100%}
.dsh-qa-browser-panel__page{display:block;width:100%;height:100%;object-fit:contain;user-select:none}
.dsh-qa-browser-panel__canvas--fit .dsh-qa-browser-panel__page{width:auto;height:auto;max-width:100%;max-height:100%}
.dsh-qa-browser-panel__page--live{cursor:crosshair}
.dsh-qa-browser-panel__chip{position:absolute;top:10px;right:10px;padding:3px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;pointer-events:none}
.dsh-qa-browser-panel__chip--human{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-qa-browser-panel__progress{position:absolute;top:0;right:0;left:0;height:2px;overflow:hidden;background:transparent}
.dsh-qa-browser-panel__progress::after{content:"";position:absolute;top:0;bottom:0;width:30%;background:var(--dsw-alias-brand-primary);animation:dsh-qa-browser-slide 1.1s ease-in-out infinite}
.dsh-qa-browser-panel__empty{max-width:340px;padding:24px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5;text-align:center}
.dsh-qa-browser-panel__canvas .dsh-qa-browser-panel__empty{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-browser-panel__menu{position:absolute;top:calc(100% - 4px);right:8px;z-index:5;display:flex;flex-direction:column;min-width:200px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 10px 28px rgba(0,0,0,.18)}
.dsh-qa-browser-panel__menu-item{appearance:none;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.dsh-qa-browser-panel__menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-browser-panel__menu-item:disabled{cursor:default;opacity:.45}
.dsh-qa-browser-panel__menu-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-qa-browser-panel__status{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 8px;min-width:0;min-height:32px;padding:6px 10px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-browser-panel__status-actions{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0}
.dsh-qa-browser-panel__control{appearance:none;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dsh-qa-browser-panel__control:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.dsh-qa-browser-panel__control:disabled{cursor:not-allowed;opacity:.6}
.dsh-qa-browser-panel__control:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-qa-browser-panel__refusal{display:flex;flex-direction:column;gap:3px;max-height:40%;overflow:auto;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.45;scrollbar-width:thin}
.dsh-qa-browser-panel__refusal-title{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-qa-browser-panel__refusal-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1px}
.dsh-qa-browser-panel__refusal-item{display:flex;align-items:baseline;gap:6px;min-width:0}
.dsh-qa-browser-panel__refusal-host{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);font:12px/18px ui-monospace,SFMono-Regular,Consolas,monospace}
.dsh-qa-browser-panel__refusal-kind{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-browser-panel__refusal-text{margin:0;color:var(--dsw-alias-label-secondary)}
.dsh-qa-browser-panel__refusal-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-browser-panel__error{padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-size:12px}
.dsh-qa-browser-panel__sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;white-space:nowrap;border:0}
@media (prefers-reduced-motion:reduce){.dsh-qa-browser-panel__tab-spinner,.dsh-qa-browser-panel__progress::after{animation:none}}
`;
