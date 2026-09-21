/**
 * The Audit view's own layout rules.
 *
 * The shared components carry their own styling; this sheet only positions
 * them inside a full conversation pane — the shell the SPEC §51 says must
 * differ between the session page and the QA dialog. The text is in English
 * and not localized yet; a one-word tab label and audit-specific jargon make
 * that a smaller debt than threading a locale namespace through two plugins.
 */
import { AUDIT_UI_STYLES } from "@yadsh/dsh-audit-ui";

const LAYOUT_STYLES = String.raw`
.dsh-audit-page{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base)}
.dsh-audit-page__body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(240px,320px) minmax(0,1fr);overflow:hidden}
.dsh-audit-page__side{min-height:0;overflow:auto;padding:14px 12px;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.dsh-audit-page__side:empty{display:none}
.dsh-audit-page__main{min-height:0;overflow:auto;padding:16px 20px}
.dsh-audit-pane{display:flex;flex-direction:column;gap:18px;max-width:920px}
.dsh-audit-pane--json{height:100%;max-width:none;padding:0;gap:0}
.dsh-audit-side__note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-page--empty{display:flex;flex-direction:column;height:100%;min-height:0}
.dsh-audit-page__state{flex:1;min-height:0}
.dsh-audit-unattached{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);padding:12px 16px}
.dsh-audit-unattached__title{margin:0 0 4px;font-size:13px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-audit-unattached__hint{margin:0 0 8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-audit-unattached__list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto}
.dsh-audit-unattached__item{display:flex;align-items:baseline;gap:8px;font-size:12px;line-height:1.5}
.dsh-audit-unattached__id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none;max-width:40%}
.dsh-audit-unattached__reason{color:var(--dsw-alias-label-tertiary);min-width:0}
@media (max-width:860px){
.dsh-audit-page__body{grid-template-columns:minmax(0,1fr)}
.dsh-audit-page__side{display:none}
}
`;

/** Everything the Audit view needs, as one sheet for one `<style>` tag. */
export const SESSION_AUDIT_STYLES = `${LAYOUT_STYLES}${AUDIT_UI_STYLES}`;

/**
 * The stylesheet's own key.
 *
 * One key owns one `<style>` tag: a second injection under a key already seen
 * is a silent no-op, which is how a sheet goes missing without an error.
 */
export const SESSION_AUDIT_STYLE_KEY = "dsh-session-audit";
