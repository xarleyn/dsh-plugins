import type { PluginLogRecordLevel } from "../../types.js";

/**
 * Severity ink for a line's level token.
 *
 * The three noisy levels ride the label ramp (dimmed → tertiary → secondary),
 * so a quiet stream stays quiet; `warn`, `error`, and `fatal` take the state
 * inks, because those are the lines a reader opens the panel to find. `fatal`
 * inverts, the way a fatal record reads in the host's own console mirror.
 */
const LEVEL_INK: Record<PluginLogRecordLevel, string> = {
  trace: "color:var(--dsw-alias-label-dimmed)",
  debug: "color:var(--dsw-alias-label-tertiary)",
  info: "color:var(--dsw-alias-label-secondary)",
  warn: "color:var(--dsw-alias-state-warn-label)",
  error: "color:var(--dsw-alias-state-error-primary)",
  fatal:
    "color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-state-error-primary);border-radius:3px;padding:0 4px",
};

/**
 * Severity ink for a filter chip, which is a pill and stays one.
 *
 * Only the ink differs from {@link LEVEL_INK}: a chip's shape is the control's,
 * so `fatal` marks itself with the soft error surface instead of taking the
 * line token's inverting badge, which would square its radius off against the
 * five pills beside it.
 */
const LEVEL_TINT: Record<PluginLogRecordLevel, string> = {
  trace: "color:var(--dsw-alias-label-dimmed)",
  debug: "color:var(--dsw-alias-label-tertiary)",
  info: "color:var(--dsw-alias-label-secondary)",
  warn: "color:var(--dsw-alias-state-warn-label)",
  error: "color:var(--dsw-alias-state-error-primary)",
  fatal: "color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-error)",
};

/** One ink rule per level, for the line's severity token. */
function levelRules(): string {
  return (Object.keys(LEVEL_INK) as PluginLogRecordLevel[])
    .map((level) => `.plu-log-level[data-plu-level=${level}]{${LEVEL_INK[level]}}`)
    .join("");
}

/** One ink rule per level, for an enabled chip. */
function chipRules(): string {
  return (Object.keys(LEVEL_TINT) as PluginLogRecordLevel[])
    .map((level) => `.plu-log-chip[data-plu-level=${level}][data-plu-level-on]{${LEVEL_TINT[level]};border-color:currentColor}`)
    .join("");
}

/**
 * The panel's stylesheet.
 *
 * Layout mirrors the Sidebar's own pane bodies (ui-sidebar-files): a flex
 * column at the pane's full height, a header band flush under the strip, and one
 * scroller below it. Type and surfaces come from the shared tokens, so light,
 * dark, and system themes stay coherent; only severity ink is hard-coded, and
 * only through the state tokens.
 */
export const PANEL_STYLES = `
.plu-log{display:flex;flex:1 1 auto;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px)}
.plu-log-bar{display:flex;flex:0 0 auto;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;box-sizing:border-box;padding:8px 12px 0 16px}
.plu-log-levels{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.plu-log-chip{appearance:none;font:inherit;font-size:11px;line-height:17px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.plu-log-chip:hover{border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-secondary)}
.plu-log-chip[data-plu-level-on]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.plu-log-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
${chipRules()}
.plu-log-actions{display:flex;gap:4px;align-items:center}
.plu-log-action{appearance:none;font:inherit;font-size:12px;padding:3px 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.plu-log-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.plu-log-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.plu-log-filters{display:flex;flex:0 0 auto;gap:6px;align-items:center;box-sizing:border-box;padding:6px 12px 8px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l3)}
.plu-log-search,.plu-log-source{box-sizing:border-box;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.plu-log-search{flex:1 1 auto;min-width:0}
.plu-log-source{flex:0 1 auto;max-width:46%;padding:0 4px 0 6px}
.plu-log-search:focus,.plu-log-source:focus{outline:none;border-color:var(--dsw-alias-border-brand)}
.plu-log-count{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.plu-log-note{margin:0;padding:6px 12px 0 16px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.plu-log-note--drop{color:var(--dsw-alias-state-warn-label)}
.plu-log-body{flex:1 1 auto;min-height:0;margin-right:2px;padding:6px 0 8px 8px;overflow:auto;scrollbar-gutter:stable;font-family:var(--dsh-code-font-family,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)}
.plu-log-empty{margin:0;padding:8px 8px 0;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:12px;line-height:1.6}
.plu-log-line{padding:1px 8px;border-radius:4px;font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.plu-log-line:hover{background:var(--dsw-alias-interactive-bg-hover)}
.plu-log-line[data-plu-level=warn],.plu-log-line[data-plu-level=error],.plu-log-line[data-plu-level=fatal]{background:var(--dsw-alias-bg-layer-2)}
.plu-log-time{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.plu-log-scope{color:var(--dsw-alias-label-tertiary)}
.plu-log-message{color:var(--dsw-alias-label-primary)}
${levelRules()}
.plu-log-level{font-weight:600}
`;
