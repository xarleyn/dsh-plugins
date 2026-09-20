/**
 * Page styles.
 *
 * Every surface, border and type level comes from a `--dsw-alias-*` token so
 * light, dark and system themes stay coherent. The only literal colours are the
 * semver-like status hues the design tokens do not carry, and they are used
 * for text and thin accents, never for a surface.
 */
export const DOMAIN_EXPERTS_STYLES = `
.dx-page{display:flex;flex-direction:column;gap:16px;min-width:0}
.dx-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dx-title{color:var(--dsw-alias-label-primary);font-size:18px;font-weight:600;line-height:1.35;margin:0}
.dx-subtitle{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5;margin:4px 0 0}
/* The list and the editor are one pane each, not two wrapping columns. A
   viewport media query cannot decide this and neither could the old
   flex-wrap: the page renders inside the settings dialog, whose width is the
   host's choice and far below the viewport, so a two-column layout collapsed
   into "the editor is below the list", out of sight. */
.dx-detail{display:flex;flex-direction:column;gap:12px;min-width:0}
.dx-detail:focus{outline:none}
.dx-back{display:inline-flex;align-items:center;gap:6px;align-self:flex-start}
.dx-back-icon{width:12px;height:12px;flex:none}
.dx-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;min-width:0}
.dx-list-card{display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;transition:border-color .16s,background .16s;min-width:0}
.dx-list-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dx-list-item{display:flex;flex-direction:column;gap:6px;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer;background:0 0;border:0;border-radius:10px 10px 0 0;padding:12px 14px;min-width:0}
.dx-list-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dx-list-actions{display:flex;gap:8px;align-items:center;border-top:1px solid var(--dsw-alias-border-l2);padding:8px 14px}
.dx-button--small{font-size:12px;padding:3px 9px}
.dx-list-name{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600}
.dx-list-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.dx-list-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
.dx-panel{display:flex;flex-direction:column;gap:16px;min-width:0;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px}
.dx-section{display:flex;flex-direction:column;gap:10px;min-width:0}
.dx-section-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;margin:0}
.dx-section-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0}
.dx-tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:8px}
.dx-tab{appearance:none;font:inherit;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid transparent;border-radius:8px;cursor:pointer;padding:5px 10px;font-size:13px}
.dx-tab:hover{background:var(--dsw-alias-bg-layer-2)}
.dx-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);font-weight:600}
.dx-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dx-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500}
.dx-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
.dx-input,.dx-textarea,.dx-select{width:100%;box-sizing:border-box;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 9px}
.dx-textarea{min-height:88px;resize:vertical;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);line-height:1.55}
.dx-input:focus-visible,.dx-textarea:focus-visible,.dx-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.dx-input[aria-invalid="true"],.dx-textarea[aria-invalid="true"]{border-color:var(--dx-danger)}
.dx-row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.dx-row>*{flex:1 1 180px;min-width:0}
.dx-check{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:13px}
.dx-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dx-button{appearance:none;font:inherit;font-size:13px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 12px}
.dx-button:hover{border-color:var(--dsw-alias-label-dimmed)}
.dx-button:disabled{cursor:not-allowed;opacity:.55}
.dx-button--primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse,var(--dsw-alias-bg-layer-1))}
.dx-button--danger{color:var(--dx-danger);border-color:var(--dx-danger)}
.dx-chip{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dx-chip--enforced{color:var(--dx-ok)}
.dx-chip--advisory{color:var(--dx-warn)}
.dx-chip--error{color:var(--dx-danger)}
.dx-table{width:100%;border-collapse:collapse;font-size:12px}
.dx-table th{text-align:left;color:var(--dsw-alias-label-tertiary);font-weight:500;padding:4px 8px 4px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dx-table td{color:var(--dsw-alias-label-secondary);padding:5px 8px 5px 0;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top;word-break:break-word}
.dx-mono{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}
.dx-persona{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:1.6;max-height:340px;overflow:auto}
.dx-issues{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.dx-issue{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dx-issue--error{color:var(--dx-danger)}
.dx-issue--warning{color:var(--dx-warn)}
.dx-status{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dx-status--error{color:var(--dx-danger)}
.dx-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6}
.dx-count{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dx-log{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;max-height:220px;overflow:auto}
.dx-log-item{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dx-persona-preview{max-height:420px}
:root{--dx-ok:#2f9e6b;--dx-warn:#c08a2a;--dx-danger:#d0524a}
`;
