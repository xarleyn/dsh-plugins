/**
 * The administrative console's stylesheet. Colors come only from the QA
 * palette tokens or the host's themed aliases, so light, dark and system themes
 * stay coherent; the stylesheet test enforces that rule.
 *
 * Layout intent: a dense table surface for triage, a side panel for the review
 * form, and no modal windows — the console is a place to work through a list,
 * not a wizard.
 */
export const QA_ADMIN_CONSOLE_STYLES = String.raw`
.dsh-qa-admin__nav-group{display:flex;flex-direction:column;gap:4px;margin-bottom:14px}
.dsh-qa-admin__page{display:flex;flex-direction:column;min-width:0;gap:20px}
.dsh-qa-admin__panel{display:flex;flex-direction:column;gap:10px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-admin__panel h2{margin:0;font-size:15px}
.dsh-qa-admin__panel h3{margin:14px 0 6px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsh-qa-admin__panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-qa-admin__columns{display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);gap:18px;align-items:start}
.dsh-qa-admin__metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.dsh-qa-admin__metric{display:flex;flex-direction:column;gap:2px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-admin__metric-label{color:var(--dsw-alias-label-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.dsh-qa-admin__metric-value{font-size:26px;line-height:1.2}
.dsh-qa-admin__metric-hint{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-admin__filters{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-admin__filter{display:flex;flex-direction:column;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-admin__filter>input,.dsh-qa-admin__filter>select,.dsh-qa-admin__filter>textarea{min-width:170px}
.dsh-qa-admin__filter>textarea{font-family:inherit;font-size:13px;resize:vertical}
.dsh-qa-admin__table{width:100%;border-collapse:collapse;font-size:13px}
.dsh-qa-admin__table th{position:sticky;top:0;padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);font-size:11px;text-align:left;text-transform:uppercase;letter-spacing:.05em}
.dsh-qa-admin__table td{padding:10px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}
.dsh-qa-admin__table td small{display:block;margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-admin__table tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-admin__badge{display:inline-block;white-space:nowrap;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:17px}
.dsh-qa-admin__badge--positive{background:var(--dsh-qa-success10);color:var(--dsh-qa-success)}
.dsh-qa-admin__badge--negative{background:var(--dsh-qa-error10);color:var(--dsh-qa-error)}
.dsh-qa-admin__badge--warning{background:var(--dsh-qa-warning10);color:var(--dsh-qa-warning-hover)}
.dsh-qa-admin__pager{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-admin__pager>span{margin-right:auto}
.dsh-qa-admin__stamp{color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-qa-admin__mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.dsh-qa-admin__alerts{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dsh-qa-admin__alert{padding:8px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);font-size:13px}
.dsh-qa-admin__alert--critical{border-color:var(--dsh-qa-error30);background:var(--dsh-qa-error10)}
.dsh-qa-admin__alert--warning{border-color:var(--dsh-qa-warning30);background:var(--dsh-qa-warning10)}
.dsh-qa-admin__recent{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dsh-qa-admin__recent li{display:grid;grid-template-columns:20px minmax(0,1fr) 140px 120px;gap:8px;align-items:center;font-size:13px}
.dsh-qa-admin__recent button{text-align:left;border-color:transparent;background:transparent;padding:2px 0}
.dsh-qa-admin__recent time{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-admin__queue{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.dsh-qa-admin__queue-item{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-left-width:3px;border-radius:10px;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-admin__queue-item--high{border-left-color:var(--dsh-qa-error)}
.dsh-qa-admin__queue-item--normal{border-left-color:var(--dsh-qa-warning)}
.dsh-qa-admin__queue-item--low{border-left-color:var(--dsw-alias-border-l2)}
.dsh-qa-admin__queue-head{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-admin__queue-head time{margin-left:auto}
.dsh-qa-admin__queue-priority{font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.05em}
.dsh-qa-admin__queue-item>button{align-self:flex-start;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;text-align:left}
.dsh-qa-admin__queue-owner{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-admin__queue-issues{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-qa-admin__conversation{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,360px);gap:20px;align-items:start}
.dsh-qa-admin__transcript{display:flex;flex-direction:column;gap:14px;min-width:0}
.dsh-qa-admin__runtime{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-admin__runtime h2{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsh-qa-admin__runtime summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-qa-admin__message{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-admin__message--user{background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-admin__message--highlighted{border-color:var(--dsh-qa-accent);box-shadow:0 0 0 2px var(--dsh-qa-accent-soft)}
.dsh-qa-admin__message>header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-admin__message>header strong{color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-qa-admin__message-text{margin:0;font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-admin__usage{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-admin__comment{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;font-style:italic}
.dsh-qa-admin__tools>button{display:inline-flex;align-items:center;gap:5px;padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-qa-admin__disclosure{flex:none;transition:transform .16s}
.dsh-qa-admin__disclosure--open{transform:rotate(180deg)}
.dsh-qa-admin__tools ol{display:flex;flex-direction:column;gap:8px;margin:8px 0 0;padding:0;list-style:none}
.dsh-qa-admin__tools li{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px}
.dsh-qa-admin__tools pre{flex-basis:100%;margin:0;padding:8px;border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto}
.dsh-qa-admin__review{display:flex;flex-direction:column;gap:12px;position:sticky;top:0;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-admin__review h2{margin:0;font-size:15px}
.dsh-qa-admin__reviews{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.dsh-qa-admin__reviews li{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;font-size:12px}
.dsh-qa-admin__reviews li>div{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-admin__reviews p{margin:0;color:var(--dsw-alias-label-secondary)}
.dsh-qa-admin__issues{display:flex;flex-direction:column;gap:10px;margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.dsh-qa-admin__issues legend{padding:0 6px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-admin__issues h4{margin:6px 0 4px;color:var(--dsw-alias-label-tertiary);font-size:10px;text-transform:uppercase;letter-spacing:.06em}
.dsh-qa-admin__issues label{display:flex;align-items:center;gap:6px;font-size:12px}
.dsh-qa-admin__checks,.dsh-qa-admin__effective,.dsh-qa-admin__issues-list,.dsh-qa-admin__trend{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dsh-qa-admin__checks label{display:flex;align-items:center;gap:6px;font-size:13px}
.dsh-qa-admin__effective li{display:flex;justify-content:space-between;gap:10px;font-size:12px}
.dsh-qa-admin__effective span{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-admin__issues-list li,.dsh-qa-admin__trend li{display:flex;justify-content:space-between;gap:10px;font-size:12px}
.dsh-qa-admin__trend li span:first-child{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-admin__facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 14px;margin:0;font-size:12px}
.dsh-qa-admin__facts--wide{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 20px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}
.dsh-qa-admin__facts--wide dd{margin-bottom:6px}
.dsh-qa-admin__facts dt{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-admin__facts dd{margin:0;color:var(--dsw-alias-label-primary)}
.dsh-qa-admin__actions{display:flex;flex-wrap:wrap;gap:8px}
.dsh-qa-feedback{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12px}
.dsh-qa-feedback>strong{color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-qa-feedback__reasons{display:flex;flex-wrap:wrap;gap:4px 14px}
.dsh-qa-feedback__reasons label{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}
.dsh-qa-feedback textarea{width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;resize:vertical}
.dsh-qa-feedback__actions{display:flex;gap:8px}
.dsh-qa-feedback__actions button{padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-qa-feedback__actions button[type="submit"]{border-color:transparent;background:var(--dsh-qa-accent);color:var(--dsh-qa-accent-contrast);font-weight:600}
@media (max-width:1100px){.dsh-qa-admin__conversation{grid-template-columns:minmax(0,1fr)}.dsh-qa-admin__columns{grid-template-columns:minmax(0,1fr)}.dsh-qa-admin__review{position:static}}
@media (max-width:760px){.dsh-qa-admin__recent li{grid-template-columns:20px minmax(0,1fr)}}
`;
