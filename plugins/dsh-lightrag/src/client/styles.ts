import { settingsBodyStyles } from "@yadsh/dsh-plugin-kit/client";

export const styles =
  `
.dsh-lightrag-body,.dsh-lightrag-body *{box-sizing:border-box;min-width:0}
.dsh-lightrag-body{display:grid;gap:16px;color:var(--dsw-alias-label-primary);padding-top:16px}
.dsh-lightrag-section h3{font-size:14px;font-weight:600;line-height:20px;margin:0 0 12px}
.dsh-lightrag-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px;overflow-wrap:anywhere}
.dsh-lightrag-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
` +
  settingsBodyStyles({
    body: ".dsh-lightrag-body",
    section: ".dsh-lightrag-section",
    sectionTitle: ".dsh-lightrag-section h3",
    grid: ".dsh-lightrag-grid",
    field: ".dsh-lightrag-field",
    fieldLabel: ".dsh-lightrag-field>span:first-child",
    hint: ".dsh-lightrag-hint",
    control: ".dsh-lightrag-control",
    button: ".dsh-lightrag-btn",
    toggleRow: ".dsh-lightrag-toggle-row",
    toggleCopy: ".dsh-lightrag-toggle-copy",
    toggle: ".dsh-lightrag-toggle",
    notice: ".dsh-lightrag-notice",
  });
