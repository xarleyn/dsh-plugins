import { QA_BLEED_MAX_WIDTH } from "./components/QaWidthHandle.js";
import { QA_ADMIN_CONSOLE_STYLES } from "./admin/styles.js";
import { AUDIT_UI_STYLES } from "@yadsh/dsh-audit-ui";
import { KATEX_CSS } from "./markdown/katex-css.js";

/**
 * Company interaction palette ("Цвета взаимодействия" guideline) — the single
 * source of every hard-coded color in this file. The object is emitted once as
 * --dsh-qa-* custom properties on the .dsh-qa-surface root; rules below may
 * only reference these tokens (brand and interaction colors) or the themed
 * --dsw-alias-* tokens (surfaces and typography keep following the host
 * light/dark theme). Rebranding = editing this one object.
 */
const QA_BRAND_PALETTE = {
  brand: "#3D9E9A",
  // Primary — CTA (Link / Link30 / TextSelect / LinkHover)
  accent: "#6D9E45",
  accentSoft: "#D4E2C3",
  textSelect: "#CBD5C6",
  accentHover: "#51733F",
  // Blue — informational
  info: "#2C71E8",
  info30: "#C0D5F8",
  info10: "#EAF1FD",
  // Green — success
  success: "#4CB250",
  success30: "#CAE6CB",
  success10: "#EEF8EE",
  // Red — failure
  error: "#EA3E3E",
  error30: "#F9C6C6",
  error10: "#FDECEC",
  errorHover: "#C13533",
  // Orange — notifications
  warning: "#FFAD0A",
  warning30: "#FFE7B6",
  warning10: "#FFF7E7",
  warningHover: "#DF9911",
  // Text/icon color placed on top of an accent fill.
  accentContrast: "#FFFFFF",
  // Translucent dialog backdrop over the conversation.
  overlay: "rgba(15, 22, 26, 0.55)",
} as const;

function tokenName(token: string): string {
  return token.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

/** Every `--dsh-qa-*` custom property the root rule declares. */
export const QA_BRAND_TOKEN_NAMES: readonly string[] =
  Object.keys(QA_BRAND_PALETTE).map(tokenName);

const QA_BRAND_TOKENS = Object.entries(QA_BRAND_PALETTE)
  .map(([token, value]) => `--dsh-qa-${tokenName(token)}:${value}`)
  .join(";");

/**
 * Overlay-compatibility mask (documented exception to the no-hiding-hacks
 * rule): while the QA surface owns the page in the OVERLAY composition, mask
 * every sibling of the host's overlay layer inside the app frame, so deleting
 * the overlay element in the browser reveals a blank page instead of the
 * operator shell. The mask hangs off the body attribute the surface effect
 * owns — not off the overlay node itself — and finds the frame structurally,
 * since the frame's own classes are CSS-module hashed.
 *
 * In the kiosk presentation this rule is not shipped at all: the host's
 * `DSH_UI_MODE=qa` composition never mounts the app frame beneath the
 * surface, so there is nothing to hide and no hack to carry.
 */
const QA_HOST_COLUMN_MASK_RULE = String.raw`
body[data-dsh-qa-surface="active"] div:has(>[data-shell-overlay])>:not([data-shell-overlay]){display:none!important}`;

export const QA_SURFACE_STYLES = String.raw`
.dsh-qa-surface{${QA_BRAND_TOKENS};position:fixed;inset:0;z-index:2147483000;pointer-events:auto;display:flex;flex-direction:row;min-width:0;height:100vh;height:100dvh;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit}
/* Root-presentation modifier (kiosk): the surface is registered into the
   runtime's 'root' slot and owns the viewport in normal flow — no fixed
   cover, no stacking race, the document has no native shell beneath it. */
.dsh-qa-surface--root{position:relative;inset:auto;z-index:auto;width:100%}
.dsh-qa-onboarding{${QA_BRAND_TOKENS};position:fixed;inset:0;z-index:2147483640;display:grid;place-items:center;padding:24px;background:var(--dsh-qa-overlay);color:var(--dsw-alias-label-primary);font-family:inherit}
.dsh-qa-onboarding__panel{display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px;width:min(620px,100%);max-height:100%;overflow-y:auto;padding:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 22px 64px rgba(0,0,0,.28)}
.dsh-qa-onboarding__mark{display:grid;place-items:center;width:44px;height:44px;border-radius:13px;background:var(--dsh-qa-accent-soft);color:var(--dsh-qa-accent-hover)}
.dsh-qa-onboarding__mark svg{width:25px;height:25px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-onboarding__content{min-width:0}
.dsh-qa-onboarding__title{margin:2px 0 12px;color:var(--dsw-alias-label-primary);font-size:20px;font-weight:650;line-height:1.35}
.dsh-qa-onboarding__description{color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1.65}
.dsh-qa-onboarding__description p{margin:0 0 12px}
.dsh-qa-onboarding__description p:last-child{margin-bottom:0}
.dsh-qa-onboarding__actions{display:flex;justify-content:flex-end;margin-top:22px}
.dsh-qa-onboarding__continue{appearance:none;min-width:164px;padding:10px 18px;border:0;border-radius:999px;background:var(--dsh-qa-accent);color:var(--dsh-qa-accent-contrast);font:inherit;font-size:14px;font-weight:600;line-height:20px;cursor:pointer;transition:background .14s,transform .14s}
.dsh-qa-onboarding__continue:hover{background:var(--dsh-qa-accent-hover)}
.dsh-qa-onboarding__continue:active{transform:translateY(1px)}
.dsh-qa-onboarding__continue:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
@media (max-width:600px){.dsh-qa-onboarding{padding:14px}.dsh-qa-onboarding__panel{grid-template-columns:1fr;gap:12px;padding:22px;border-radius:15px}.dsh-qa-onboarding__mark{width:38px;height:38px;border-radius:11px}.dsh-qa-onboarding__title{font-size:18px}.dsh-qa-onboarding__actions{margin-top:18px}.dsh-qa-onboarding__continue{width:100%}}
.dsh-qa-body{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.dsh-qa-workspace{position:relative;display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}
.dsh-qa-chat{position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.dsh-qa-sidebar{flex:none;position:relative;width:var(--dsh-qa-sidebar-width,264px);display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dsh-qa-sidebar--collapsed{width:52px;align-items:center;padding-top:12px}
.dsh-qa-sidebar__resize{position:absolute;top:0;bottom:0;right:-4px;width:8px;cursor:col-resize;touch-action:none;user-select:none;z-index:11}
.dsh-qa-sidebar__head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex:none;padding:14px 10px 10px 16px}
.dsh-qa-sidebar__brand{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-qa-sidebar__logo{display:grid;place-items:center;width:20px;height:20px;flex:none;color:var(--dsh-qa-brand)}
.dsh-qa-sidebar__logo svg,.dsh-qa-sidebar__logo img{width:20px;height:20px;display:block;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-sidebar__logo img{object-fit:contain;border-radius:6px}
.dsh-qa-sidebar__name{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-sidebar__collapse,.dsh-qa-sidebar__expand{appearance:none;display:grid;place-items:center;flex:none;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-sidebar__collapse:hover,.dsh-qa-sidebar__expand:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-sidebar__collapse:focus-visible,.dsh-qa-sidebar__expand:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sidebar__collapse svg,.dsh-qa-sidebar__expand svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round;transition:transform .16s}.dsh-qa-sidebar__expand svg{transform:rotate(180deg)}
.dsh-qa-sidebar__newbar{flex:none;padding:2px 12px 10px}
.dsh-qa-sidebar__new{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;line-height:18px;cursor:pointer;transition:border-color .12s,background .12s}
.dsh-qa-sidebar__new:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-sidebar__new:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sidebar__new:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsh-qa-sidebar__new svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-sidebar__search{position:relative;flex:none;padding:0 12px 10px}
.dsh-qa-sidebar__search>svg{position:absolute;top:17px;left:22px;width:14px;height:14px;fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;transform:translateY(-50%)}
.dsh-qa-sidebar__search input{display:block;width:100%;height:34px;min-width:0;padding:0 34px 0 32px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;-webkit-appearance:none;appearance:none}
.dsh-qa-sidebar__search input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
.dsh-qa-sidebar__search input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-sidebar__search input:focus{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px;border-color:transparent}
.dsh-qa-sidebar__search-clear{position:absolute;top:17px;right:18px;display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transform:translateY(-50%)}
.dsh-qa-sidebar__search-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-sidebar__search-clear:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sidebar__search-clear svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-sidebar__list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 8px 12px}
.dsh-qa-sidebar__group{margin-top:6px}
.dsh-qa-sidebar__group:first-child{margin-top:0}
.dsh-qa-sidebar__group-name{padding:4px 6px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-qa-sidebar__empty{margin:8px 8px 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px}
.dsh-qa-sidebar__item{position:relative;display:flex;align-items:center;width:100%;padding:2px;border-radius:8px}
.dsh-qa-sidebar__item:hover,.dsh-qa-sidebar__item--active{background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-sidebar__item-main{appearance:none;display:flex;align-items:center;gap:8px;width:100%;min-width:0;border:0;background:0 0;cursor:pointer;text-align:left;font:inherit;padding:7px 8px;border-radius:8px}
.dsh-qa-sidebar__item-main:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sidebar__item-delete{appearance:none;position:absolute;top:50%;right:4px;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;background:var(--dsw-alias-bg-layer-2);cursor:pointer;color:var(--dsw-alias-label-tertiary);padding:5px;border-radius:6px;opacity:0;transform:translateY(-50%);transition:opacity .12s}
.dsh-qa-sidebar__item:hover .dsh-qa-sidebar__item-delete,.dsh-qa-sidebar__item-delete:focus-visible,.dsh-qa-sidebar__item-delete--confirm{opacity:1}
.dsh-qa-sidebar__item-delete:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-sidebar__item-audit{appearance:none;flex:none;display:inline-flex;align-items:center;gap:4px;height:22px;margin-right:4px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;transition:border-color .12s,color .12s}
.dsh-qa-sidebar__item-audit--with-delete{margin-right:28px}
.dsh-qa-sidebar__item-audit:hover{border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.dsh-qa-sidebar__item-audit:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sidebar__item-audit-check{width:11px;height:11px;flex:none;color:var(--dsw-alias-state-success-primary)}
.dsh-qa-sidebar__item-audit-verdict{font-weight:600}
.dsh-qa-sidebar__item-audit-verdict--good{color:var(--dsw-alias-state-success-primary)}
.dsh-qa-sidebar__item-audit-verdict--warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-qa-sidebar__item-audit-verdict--bad{color:var(--dsw-alias-state-error-primary)}
.dsh-qa-sidebar__item-delete:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sidebar__item-delete--confirm{color:var(--dsh-qa-error-hover)}
.dsh-qa-sidebar__item-delete svg{width:14px;height:14px;display:block;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-sidebar__item-title{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-sidebar__item--active .dsh-qa-sidebar__item-title{color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-qa-sidebar__item-meta{flex:none;display:flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px}
.dsh-qa-sidebar__dot{width:7px;height:7px;border-radius:999px;background:var(--dsh-qa-brand);flex:none}
.dsh-qa-sidebar__footer{flex:none;padding:8px 16px 12px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-sidebar__version{appearance:none;display:inline-flex;align-items:center;padding:2px 0;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:16px;cursor:pointer;transition:color .12s}
.dsh-qa-sidebar__version:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-sidebar__version:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px;border-radius:4px}
.dsh-qa-sidebar__account{display:flex;align-items:center;gap:6px;min-width:0;margin-bottom:6px}
.dsh-qa-sidebar__account-name{appearance:none;min-width:0;overflow:hidden;padding:0;border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:16px;text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;transition:color .12s}
.dsh-qa-sidebar__account-name:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-sidebar__account-name:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px;border-radius:4px}
.dsh-qa-sidebar__account-role{flex:none;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:500;line-height:15px}
.dsh-qa-sidebar__account-exit{appearance:none;display:grid;place-items:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-sidebar__account-exit:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-sidebar__account-exit:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sidebar__account-exit svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-auth{align-items:center;justify-content:center;padding:24px}
.dsh-qa-auth__card{display:flex;flex-direction:column;gap:14px;width:min(360px,100%);padding:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 18px 48px var(--dsh-qa-overlay)}
.dsh-qa-auth__brand{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.dsh-qa-auth__logo{width:32px;height:32px;fill:none;stroke:var(--dsh-qa-brand);stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-auth__brand h1{margin:0;color:var(--dsw-alias-label-primary);font-size:19px;font-weight:600;line-height:26px}
.dsh-qa-auth__tabs{display:flex;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-module-platform)}
.dsh-qa-auth__tab{appearance:none;flex:1;padding:6px 0;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:500;line-height:18px;cursor:pointer;transition:background .12s,color .12s}
.dsh-qa-auth__tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-auth__tab--active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-qa-auth__tab:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-auth__field{display:flex;flex-direction:column;gap:5px}
.dsh-qa-auth__field span{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}
.dsh-qa-auth__field input{appearance:none;width:100%;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px}
.dsh-qa-auth__field input:focus{outline:none;border-color:var(--dsh-qa-brand)}
.dsh-qa-auth__field input:disabled{opacity:.55}
.dsh-qa-auth__error{margin:0;color:var(--dsh-qa-error);font-size:12px;line-height:17px}
.dsh-qa-auth__submit{appearance:none;margin-top:2px;padding:10px 0;border:0;border-radius:9px;background:var(--dsh-qa-brand);color:var(--dsh-qa-accent-contrast);font:inherit;font-size:14px;font-weight:600;line-height:20px;cursor:pointer;transition:background .12s}
.dsh-qa-auth__submit:hover{background:var(--dsh-qa-accent-hover)}
.dsh-qa-auth__submit:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-auth__submit:disabled{opacity:.6;cursor:default}
.dsh-qa-auth__lead{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-auth__notice{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}
.dsh-qa-auth__link{appearance:none;padding:0;border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:17px;text-align:center;text-decoration:underline;cursor:pointer}
.dsh-qa-auth__link:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-auth__link:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-auth__link:disabled{opacity:.6;cursor:default}
.dsh-qa-crash{align-items:center;justify-content:center;padding:24px}
.dsh-qa-crash__card{display:flex;flex-direction:column;gap:12px;width:min(380px,100%);padding:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 18px 48px var(--dsh-qa-overlay);text-align:center}
.dsh-qa-crash__card h1{margin:0;color:var(--dsw-alias-label-primary);font-size:19px;font-weight:600;line-height:26px}
.dsh-qa-crash__card p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:19px}
.dsh-qa-crash__reload{appearance:none;margin-top:6px;padding:10px 0;border:0;border-radius:9px;background:var(--dsh-qa-brand);color:var(--dsh-qa-accent-contrast);font:inherit;font-size:14px;font-weight:600;line-height:20px;cursor:pointer;transition:background .12s}
.dsh-qa-crash__reload:hover{background:var(--dsh-qa-accent-hover)}
.dsh-qa-crash__reload:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-modal{${QA_BRAND_TOKENS};position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:24px;background:var(--dsh-qa-overlay)}
.dsh-qa-modal *{box-sizing:border-box}
.dsh-qa-modal__panel{display:flex;flex-direction:column;width:min(560px,100%);max-height:min(640px,calc(100vh - 48px));border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 18px 48px var(--dsh-qa-overlay);overflow:hidden}
.dsh-qa-modal__panel--wide{width:min(720px,100%)}
.dsh-qa-modal__head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-modal__title{margin:0;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:20px}
.dsh-qa-modal__close{appearance:none;display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-modal__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-modal__close:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-modal__close svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-audit-dialog{display:flex;flex-direction:column;min-height:0;height:100%}
.dsh-qa-audit-dialog__body{flex:1;min-height:0;overflow:auto;padding:16px 18px}
.dsh-qa-audit-dialog__body .dsh-audit-json{height:100%;min-height:320px}
.dsh-qa-modal__body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 18px 18px}
.dsh-qa-modal__footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:none;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-changelog__entry{padding-top:10px}
.dsh-qa-changelog__version{display:flex;align-items:baseline;gap:8px;margin:0 0 2px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
.dsh-qa-changelog__date{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:16px}
.dsh-qa-changelog__current{padding:0 8px;border-radius:999px;background:var(--dsh-qa-accent-soft);color:var(--dsh-qa-accent-hover);font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.dsh-qa-changelog__section{margin:6px 0 0}
.dsh-qa-changelog__section-title{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:18px}
.dsh-qa-changelog__list{margin:4px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-qa-changelog__list li{margin:3px 0}
.dsh-qa-changelog__list li::marker{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-modal__panel--settings{width:min(840px,100%);height:min(640px,calc(100vh - 48px))}
.dsh-qa-modal__panel--document{width:min(1100px,100%);height:min(880px,calc(100vh - 48px))}
.dsh-qa-modal__panel--settings .dsh-qa-modal__body{padding:0;overflow:hidden}
.dsh-qa-settings{display:grid;grid-template-columns:200px minmax(0,1fr);height:100%;min-height:0}
.dsh-qa-settings__nav{display:flex;flex-direction:column;gap:2px;padding:12px 10px;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);overflow-y:auto}
.dsh-qa-settings__tab{appearance:none;text-align:left;padding:8px 10px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:19px;cursor:pointer}
.dsh-qa-settings__tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-settings__tab--active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-qa-settings__tab:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-settings__content{min-width:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;padding:16px 20px 0}
.dsh-qa-settings__page{display:flex;flex-direction:column;gap:14px;min-height:100%;padding-bottom:22px}
.dsh-qa-settings__lead{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-settings__page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsh-qa-settings__head-text{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsh-qa-settings__head-actions{display:flex;align-items:center;gap:8px;flex:none}
.dsh-qa-settings__page-title{margin:0;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:21px}
.dsh-qa-settings__back{appearance:none;padding:4px 8px 4px 0;border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:19px;cursor:pointer}
.dsh-qa-settings__back:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-settings__back:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-settings__section{display:flex;flex-direction:column;gap:10px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-settings__section-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.dsh-qa-settings__section-title{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:19px}
.dsh-qa-settings__section-aside{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-settings__field{display:flex;flex-direction:column;gap:5px}
.dsh-qa-settings__field-label{display:flex;flex-direction:column;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}
.dsh-qa-settings__field input,.dsh-qa-settings__field textarea{appearance:none;width:100%;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px}
.dsh-qa-settings__field textarea{min-height:64px;line-height:19px;resize:vertical}
.dsh-qa-settings__field input:focus,.dsh-qa-settings__field textarea:focus{outline:none;border-color:var(--dsh-qa-brand)}
.dsh-qa-settings__field select{appearance:none;width:100%;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px}
.dsh-qa-settings__field select:focus{outline:none;border-color:var(--dsh-qa-brand)}
.dsh-qa-settings__field input:read-only{opacity:.6}
.dsh-qa-settings__code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:20px}
.dsh-qa-settings__field-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-settings__count{margin:-8px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-align:right}
.dsh-qa-settings__toggle-row{display:flex;flex-direction:column;gap:3px}
.dsh-qa-settings__toggle{display:flex;align-items:flex-start;gap:9px;cursor:pointer}
.dsh-qa-settings__toggle input{flex:none;width:16px;height:16px;margin:1px 0 0;accent-color:var(--dsh-qa-brand)}
.dsh-qa-settings__toggle-label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px}
.dsh-qa-settings__notice{margin:0;padding:9px 11px;border-radius:9px;font-size:12px;line-height:17px}
.dsh-qa-settings__notice--info{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dsh-qa-settings__notice--warn{background:var(--dsh-qa-warning10);color:var(--dsh-qa-warning)}
.dsh-qa-settings__notice--error{background:var(--dsh-qa-error10);color:var(--dsh-qa-error)}
.dsh-qa-settings__link{appearance:none;padding:0;border:0;background:0 0;color:var(--dsh-qa-brand);font:inherit;font-size:12px;line-height:17px;text-decoration:underline;cursor:pointer}
.dsh-qa-settings__link:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-settings__actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;position:sticky;bottom:0;margin:auto -20px -22px;padding:12px 20px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-settings__button{appearance:none;padding:8px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:19px;cursor:pointer;transition:color .12s,background .12s}
.dsh-qa-settings__button:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-qa-settings__button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-settings__button:disabled{opacity:.6;cursor:default}
.dsh-qa-settings__button--primary{border-color:transparent;background:var(--dsh-qa-brand);color:var(--dsh-qa-accent-contrast);font-weight:600}
.dsh-qa-settings__button--primary:hover:not(:disabled){background:var(--dsh-qa-accent-hover);color:var(--dsh-qa-accent-contrast)}
.dsh-qa-settings__button--danger{border-color:var(--dsw-alias-label-error);color:var(--dsw-alias-label-error)}
.dsh-qa-settings__button--danger:hover:not(:disabled){background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error)}
.dsh-qa-settings__empty{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:22px 18px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-settings__empty-title{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}
.dsh-qa-settings__search{appearance:none;width:100%;padding:8px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:19px}
.dsh-qa-settings__search:focus{outline:none;border-color:var(--dsh-qa-brand)}
.dsh-qa-settings__rows{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dsh-qa-settings__row{margin:0}
.dsh-qa-settings__row-button{appearance:none;display:flex;flex-direction:column;gap:4px;width:100%;padding:11px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-3);text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.dsh-qa-settings__row-button:hover{border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-settings__row-button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-settings__row-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}
.dsh-qa-settings__row-description{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:19px}
.dsh-qa-settings__row-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-settings__row-note{color:var(--dsh-qa-info,var(--dsw-alias-label-secondary));font-size:12px;line-height:17px}
.dsh-qa-settings__row-warning{color:var(--dsh-qa-warning);font-size:12px;line-height:17px}
.dsh-qa-settings__row-error{color:var(--dsh-qa-error);font-size:12px;line-height:17px}
.dsh-qa-settings__chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.dsh-qa-settings__chip{display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-qa-settings__chip--unavailable{border-style:dashed;color:var(--dsh-qa-warning)}
.dsh-qa-settings__chip-remove{appearance:none;padding:0 3px;border:0;border-radius:999px;background:0 0;color:inherit;font:inherit;font-size:14px;line-height:16px;cursor:pointer}
.dsh-qa-settings__chip-remove:hover{color:var(--dsh-qa-error)}
.dsh-qa-settings__diagnostics{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none}
.dsh-qa-settings__diagnostic{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-settings__diagnostic--error{color:var(--dsh-qa-error)}
.dsh-qa-settings__advanced{display:flex;flex-direction:column;gap:10px}
.dsh-qa-settings__preview{max-height:240px;margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.dsh-qa-settings__facts{display:flex;flex-direction:column;gap:6px;margin:0}
.dsh-qa-settings__fact{display:flex;gap:10px;margin:0}
.dsh-qa-settings__fact dt{flex:none;width:120px;margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-qa-settings__fact dd{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;min-width:0;word-break:break-word}
.dsh-qa-settings__list{margin:0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-qa-settings__list li{margin:2px 0}
.dsh-qa-starters__list{display:flex;flex-direction:column;gap:10px}
.dsh-qa-starters__item{display:grid;grid-template-columns:minmax(0,1fr) 28px;column-gap:8px;row-gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-starters__item>.dsh-qa-settings__field{grid-column:1}
.dsh-qa-starters__remove{appearance:none;grid-column:2;grid-row:1;align-self:end;flex:none;width:28px;height:28px;margin-bottom:6px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-starters__remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsh-qa-error)}
.dsh-qa-starters__remove:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-starters__remove svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-toolpicker__list{display:flex;flex-direction:column;gap:2px;max-height:min(52vh,440px);margin:8px 0 0;padding:0;list-style:none;overflow-y:auto}
.dsh-qa-toolpicker__group{padding:8px 0 3px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:16px}
.dsh-qa-toolpicker__row{margin:0}
.dsh-qa-toolpicker__label{display:grid;grid-template-columns:16px minmax(0,auto) minmax(0,1fr);align-items:baseline;gap:9px;padding:6px 8px;border-radius:8px;cursor:pointer}
.dsh-qa-toolpicker__label:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-toolpicker__label input{width:15px;height:15px;margin:0;accent-color:var(--dsh-qa-brand)}
.dsh-qa-toolpicker__name{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px}
.dsh-qa-toolpicker__description{display:-webkit-box;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;min-width:0;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.dsh-qa-toolpicker__selected{margin-right:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
@media (max-width:720px){.dsh-qa-modal__panel--settings{height:min(640px,calc(100vh - 48px))}.dsh-qa-settings{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.dsh-qa-settings__nav{flex-direction:row;gap:4px;padding:8px 10px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-x:auto;overflow-y:hidden}.dsh-qa-settings__tab{white-space:nowrap}.dsh-qa-settings__content{padding:12px 14px 0}.dsh-qa-settings__page{padding-bottom:18px}.dsh-qa-settings__actions{margin:auto -14px -18px;padding:10px 14px}}
.dsh-qa-surface *{box-sizing:border-box}
.dsh-qa-surface ::selection{background:var(--dsh-qa-text-select)}
.dsh-qa-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.dsh-qa-header{position:relative;flex:none;background:var(--dsw-alias-bg-base)}
.dsh-qa-header::after{content:"";position:absolute;right:0;bottom:1px;left:0;height:1px;background:var(--dsw-alias-border-l2);pointer-events:none}
.dsh-qa-header__inner{width:100%;padding:11px 28px 0 30px}
.dsh-qa-header__title-row{display:flex;align-items:center;min-height:32px;gap:10px}
.dsh-qa-header__actions{display:flex;align-items:center;flex:none;gap:10px;margin-left:auto}
.dsh-qa-header__logo{width:24px;height:24px;object-fit:contain;border-radius:6px;flex:none}
.dsh-qa-header h1{max-width:min(42vw,420px);min-width:0;overflow:hidden;margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-header__reset{padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dsh-qa-header__agents{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-qa-header__agents:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__agents:disabled{opacity:.45;cursor:default}
.dsh-qa-header__agents[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__agents svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-header__agents:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-agentview{display:flex;align-items:center;gap:8px;flex:none;padding:6px 28px;border-bottom:1px solid var(--dsh-qa-info30);background:var(--dsh-qa-info10);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-qa-header__viewing{display:inline-flex;align-items:center;gap:7px;flex:none;padding:3px 10px;border-radius:999px;background:var(--dsh-qa-info10);color:var(--dsh-qa-info);font-size:13px;line-height:20px;white-space:nowrap}
.dsh-qa-header__viewing > svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-header__back{border:0;background:transparent;padding:0;color:var(--dsh-qa-info);font:inherit;font-size:13px;font-weight:500;line-height:20px;cursor:pointer}
.dsh-qa-header__back:hover{text-decoration:underline}
.dsh-qa-header__back:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-agentview strong{color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-qa-agentview__icon{width:16px;height:16px;flex:none;fill:none;stroke:var(--dsh-qa-info);stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-agentview button{margin-left:auto;flex:none;padding:4px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsh-qa-info);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.dsh-qa-agentview button:hover{background:color-mix(in srgb,var(--dsh-qa-info) 12%,transparent)}
.dsh-qa-agentview button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-agents{flex:none;display:flex;flex-direction:column;width:360px;min-height:0;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dsh-qa-agents__head{display:flex;align-items:center;justify-content:space-between;flex:none;padding:14px 12px 10px 16px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
.dsh-qa-agents__head button{appearance:none;display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-agents__head button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-agents__head button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-agents__head button svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round}
.dsh-qa-agents__list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 10px 12px}
.dsh-qa-agents__item{display:flex;align-items:center;gap:10px;width:100%;margin:0 0 6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);font:inherit;text-align:left;cursor:pointer}
.dsh-qa-agents__item:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-qa-agents__item--active{border-color:var(--dsh-qa-brand)}
.dsh-qa-agents__item:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-agents__dot{width:8px;height:8px;flex:none;border-radius:999px;background:var(--dsw-alias-label-tertiary)}
.dsh-qa-agents__dot--running{background:var(--dsh-qa-success)}
.dsh-qa-agents__text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsh-qa-agents__title{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-agents__meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}
.dsh-qa-agents__meta-list{display:flex;gap:8px}
.dsh-qa-agents__open{flex:none;color:var(--dsh-qa-accent);font-size:12px;font-weight:500;line-height:18px}
.dsh-qa-header__sources{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-qa-header__sources:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__sources:disabled{opacity:.45;cursor:default}
.dsh-qa-header__sources[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__sources svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-header__sources:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-header__files{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-qa-header__files:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__files:disabled{opacity:.45;cursor:default}
.dsh-qa-header__files[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__files svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-header__files:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-header__settings{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-qa-header__settings:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__settings svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-header__settings:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-role-selector select,.dsh-qa-header__admin{height:30px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;cursor:pointer}
.dsh-qa-role-selector select:hover,.dsh-qa-header__admin:hover{border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.dsh-qa-role-selector select:focus-visible,.dsh-qa-header__admin:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-header__admin{white-space:nowrap}
.dsh-qa-admin-preview{position:absolute;z-index:8;right:20px;bottom:14px;display:flex;align-items:center;gap:8px;padding:5px 6px 5px 12px;border:1px solid var(--dsh-qa-warning);border-radius:999px;background:var(--dsh-qa-warning10);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:700;letter-spacing:.04em}
.dsh-qa-admin-preview__exit{appearance:none;border:1px solid var(--dsh-qa-warning);border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;font-weight:600;letter-spacing:.02em;padding:2px 9px;cursor:pointer}
.dsh-qa-admin-preview__exit:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-qa-admin-preview__exit:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-role-selector__notice{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1.6}
.dsh-qa-admin{${QA_BRAND_TOKENS};position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit}
.dsh-qa-admin *{box-sizing:border-box}
.dsh-qa-admin button,.dsh-qa-admin input,.dsh-qa-admin textarea,.dsh-qa-admin select{font:inherit}
.dsh-qa-admin__header{display:flex;align-items:center;justify-content:space-between;min-height:64px;padding:10px 24px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-admin__header>div{display:flex;flex-direction:column;gap:2px}.dsh-qa-admin__header strong{font-size:16px}.dsh-qa-admin__header span{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-qa-admin button{padding:7px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer}.dsh-qa-admin button:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}.dsh-qa-admin button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}.dsh-qa-admin button:disabled{opacity:.45;cursor:default}
.dsh-qa-admin__layout{display:grid;grid-template-columns:220px minmax(0,1fr);flex:1;min-height:0}.dsh-qa-admin__layout>nav{display:flex;flex-direction:column;gap:4px;padding:24px 14px;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}.dsh-qa-admin__layout>nav strong{padding:0 10px 10px;color:var(--dsw-alias-label-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:.06em}.dsh-qa-admin__layout>nav button{text-align:left;border-color:transparent;background:transparent}.dsh-qa-admin__layout>nav button[aria-current="page"]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-qa-admin__content,.dsh-qa-role-editor{min-width:0;overflow-y:auto;padding:30px clamp(20px,4vw,56px) 90px}.dsh-qa-admin__title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin:0 0 24px}.dsh-qa-admin__title-row h1,.dsh-qa-admin__title-row h2{margin:0 0 6px;font-size:24px}.dsh-qa-admin__title-row p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dsh-qa-admin__primary{border-color:transparent!important;background:var(--dsh-qa-accent)!important;color:var(--dsh-qa-accent-contrast)!important;font-weight:600}.dsh-qa-admin__danger{color:var(--dsh-qa-error)!important}.dsh-qa-admin__back{margin:0 0 12px;padding-left:0!important;border:0!important;background:transparent!important;color:var(--dsh-qa-accent)!important}
.dsh-qa-role-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}.dsh-qa-role-card{display:flex;flex-direction:column;gap:16px;min-width:0;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2)}.dsh-qa-role-card__head{display:flex;align-items:flex-start;gap:10px}.dsh-qa-role-card__head>span{font-size:22px}.dsh-qa-role-card__head>div{flex:1;min-width:0}.dsh-qa-role-card h2{margin:0;font-size:17px}.dsh-qa-role-card code{color:var(--dsw-alias-label-tertiary);font-size:11px}.dsh-qa-role-card em{padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:10px;font-style:normal}.dsh-qa-role-card>p{min-height:38px;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:19px}.dsh-qa-role-card__counts{display:flex;flex-wrap:wrap;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:11px}.dsh-qa-role-card__actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}.dsh-qa-role-card__actions button{padding:5px 8px;font-size:11px}
.dsh-qa-admin__tabs{display:flex;gap:4px;margin:0 0 18px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-qa-admin__tabs button{margin-bottom:-1px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent}.dsh-qa-admin__tabs button[aria-current="page"]{border-bottom-color:var(--dsh-qa-accent);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-qa-capabilities__toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.dsh-qa-capabilities__toolbar>input{width:min(420px,65%)}.dsh-qa-capabilities__toolbar label{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-qa-admin input[type="search"],.dsh-qa-admin input:not([type]),.dsh-qa-admin input[type="text"],.dsh-qa-admin textarea,.dsh-qa-admin select{padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary)}.dsh-qa-capabilities__group{margin:0 0 20px}.dsh-qa-capabilities__group h4{margin:0 0 6px;color:var(--dsw-alias-label-tertiary);font-size:10px;letter-spacing:.06em}.dsh-qa-capability{display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:9px}.dsh-qa-capability:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-qa-capability>input{margin-top:3px;accent-color:var(--dsh-qa-accent)}.dsh-qa-capability__copy{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}.dsh-qa-capability__copy strong{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}.dsh-qa-capability__copy small{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-qa-capability>em{color:var(--dsw-alias-label-tertiary);font-size:10px;font-style:normal}.dsh-qa-capability__missing{color:var(--dsh-qa-warning-hover)!important}
.dsh-qa-role-editor__general{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.dsh-qa-role-editor__general label{display:flex;flex-direction:column;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-qa-role-editor__general input,.dsh-qa-role-editor__general textarea{width:100%}.dsh-qa-role-editor__general textarea{min-height:100px;resize:vertical}.dsh-qa-role-editor__wide{grid-column:1/-1}.dsh-qa-role-editor__check{flex-direction:row!important;align-items:center}.dsh-qa-effective>p{padding:10px;border-radius:9px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-qa-effective h3{font-size:16px}
.dsh-qa-admin__savebar{position:sticky;bottom:-90px;display:flex;align-items:center;justify-content:flex-end;gap:8px;margin:28px clamp(-56px,-4vw,-20px) -90px;padding:14px clamp(20px,4vw,56px);border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}.dsh-qa-admin__savebar>span{margin-right:auto;color:var(--dsw-alias-label-tertiary);font-size:11px}.dsh-qa-admin__impact{margin:20px 0 0;padding:12px;border:1px solid var(--dsh-qa-warning30);border-radius:10px;background:var(--dsh-qa-warning10);font-size:12px;line-height:18px}.dsh-qa-admin__error{margin:0 0 16px;padding:10px;border:1px solid var(--dsh-qa-error30);border-radius:9px;background:var(--dsh-qa-error10);color:var(--dsh-qa-error);font-size:12px}.dsh-qa-admin__loading{margin:auto;color:var(--dsw-alias-label-secondary)}.dsh-qa-admin__empty{color:var(--dsw-alias-label-tertiary);font-size:13px}
.dsh-qa-users{overflow:auto}.dsh-qa-users table{width:100%;border-collapse:collapse;font-size:12px}.dsh-qa-users th,.dsh-qa-users td{padding:10px;border-bottom:1px solid var(--dsw-alias-border-l2);text-align:left;vertical-align:top}.dsh-qa-users td>small{display:block;color:var(--dsw-alias-label-tertiary)}.dsh-qa-users__roles{display:flex;flex-wrap:wrap;gap:8px}.dsh-qa-users__roles label{white-space:nowrap}.dsh-qa-audit{display:flex;flex-direction:column;gap:8px;padding:0;list-style:none}.dsh-qa-audit li{display:grid;grid-template-columns:160px 150px minmax(120px,1fr) minmax(160px,1fr);gap:10px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);font-size:11px}.dsh-qa-audit time,.dsh-qa-audit code{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-audit details{grid-column:1/-1}.dsh-qa-audit summary{color:var(--dsh-qa-accent);cursor:pointer}.dsh-qa-audit pre{max-height:240px;overflow:auto;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:11px/17px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-tool-buckets{display:flex;flex-direction:column;gap:26px}.dsh-qa-tool-buckets>section>h3{margin:0 0 4px;font-size:15px}.dsh-qa-tool-buckets>section>p{margin:0 0 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-skill-grants{margin:18px 0 0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dsh-qa-skill-grants h4{margin:0 0 8px;color:var(--dsw-alias-label-tertiary);font-size:10px;letter-spacing:.06em;text-transform:uppercase}.dsh-qa-skill-grants ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}.dsh-qa-skill-grants li{display:flex;align-items:baseline;gap:8px;font-size:12px}.dsh-qa-skill-grants span{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-role-skills>p{margin:0 0 18px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}.dsh-qa-role-skills>section{margin:0 0 26px}.dsh-qa-role-skills h4{margin:0 0 8px;font-size:13px}.dsh-qa-role-skills__hint{margin:8px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-skill-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}.dsh-qa-skill-list li{display:flex;align-items:baseline;gap:10px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);font-size:12px}.dsh-qa-skill-list li strong{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}.dsh-qa-skill-list li span{color:var(--dsw-alias-label-tertiary);font-size:11px}.dsh-qa-skill-list li em{margin-left:auto;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:10px;font-style:normal}
.dsh-qa-effective section{margin:0 0 20px}.dsh-qa-effective h4{margin:0 0 8px;color:var(--dsw-alias-label-tertiary);font-size:10px;letter-spacing:.06em;text-transform:uppercase}.dsh-qa-effective__list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}.dsh-qa-effective__list li{display:flex;align-items:baseline;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);font-size:12px}.dsh-qa-effective__list span{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-skills{overflow:auto}.dsh-qa-skills table{width:100%;border-collapse:collapse;font-size:12px}.dsh-qa-skills th,.dsh-qa-skills td{padding:10px;border-bottom:1px solid var(--dsw-alias-border-l2);text-align:left;vertical-align:top}.dsh-qa-skills td>strong{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.dsh-qa-skills td>em{margin-right:6px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:10px;font-style:normal}
.dsh-qa-skill-detail__grid{display:grid;grid-template-columns:minmax(240px,320px) minmax(0,1fr);gap:24px}.dsh-qa-skill-detail__grid h4{margin:0 0 10px;color:var(--dsw-alias-label-tertiary);font-size:10px;letter-spacing:.06em;text-transform:uppercase}.dsh-qa-skill-roles{margin:12px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}.dsh-qa-skill-roles li{display:flex;align-items:center;gap:10px;font-size:12px}.dsh-qa-skill-roles em{padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:10px;font-style:normal}.dsh-qa-skill-tools{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}.dsh-qa-skill-tools li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);font-size:12px}.dsh-qa-skill-tools code{flex:none}.dsh-qa-skill-tools__state{display:flex;flex:1 1 auto;flex-wrap:wrap;justify-content:flex-end;gap:2px 12px;min-width:0}.dsh-qa-skill-tools em{color:var(--dsw-alias-label-tertiary);font-size:11px;font-style:normal}.dsh-qa-skill-warnings{margin:14px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;color:var(--dsh-qa-warning-hover);font-size:11px;line-height:16px}
.dsh-qa-panel-launcher{display:flex;align-items:center;gap:2px;flex:none}
.dsh-qa-panel-launcher__button{appearance:none;display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-qa-panel-launcher__button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-panel-launcher__button[aria-pressed="true"]{background:var(--dsw-alias-bg-module-platform);color:var(--dsh-qa-accent)}
.dsh-qa-panel-launcher__button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-panel-launcher__button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-header__reset:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-header__reset:disabled{opacity:.45;cursor:default}
.dsh-qa-header__tabs{position:relative;z-index:1;display:flex;gap:32px;margin-top:4px}
.dsh-qa-header__tabs span{position:relative;padding:0 0 11px;color:var(--dsh-qa-accent);font-size:13px;font-weight:500;line-height:16px}
.dsh-qa-header__tabs span::after{content:"";position:absolute;right:0;bottom:1px;left:0;height:2px;border-radius:2px;background:var(--dsh-qa-accent)}
.dsh-qa-extension-panel__resizer{position:relative;z-index:2;flex:0 0 5px;width:5px;touch-action:none;cursor:col-resize;background:var(--dsw-alias-border-l2)}
.dsh-qa-extension-panel__resizer:hover,.dsh-qa-extension-panel__resizer:focus-visible{background:var(--dsh-qa-accent);outline:0}
.dsh-qa-extension-panel{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-qa-extension-panel--side{flex:0 0 auto}
.dsh-qa-extension-panel--fullscreen{position:absolute;inset:0;z-index:8;width:100%;height:100%}
.dsh-qa-extension-panel__header{display:flex;align-items:center;gap:12px;flex:none;min-height:48px;padding:8px 12px 8px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-extension-panel__header h2{flex:1;min-width:0;overflow:hidden;margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-extension-panel__close{appearance:none;display:grid;place-items:center;flex:none;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-extension-panel__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-extension-panel__close:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-extension-panel__close svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-extension-panel__bodies,.dsh-qa-extension-panel__body{position:relative;flex:1;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden}
.dsh-qa-extension-panel__body[hidden]{display:none}
.dsh-qa-extension-panel__fallback{display:grid;place-items:center;width:100%;height:100%;padding:24px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:19px;text-align:center}
.dsh-qa-transcript{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.dsh-qa-transcript__inner{--dsh-qa-side-space:max(0px,calc((var(--dsh-qa-column-width,0px) - var(--dsh-qa-content-width))/2));--dsh-qa-bleed:min(${QA_BLEED_MAX_WIDTH}px,var(--dsh-qa-side-space));width:100%;max-width:var(--dsh-qa-content-width);min-height:100%;margin:0 auto;padding:18px 16px 42px}
.dsh-qa-width-handle{position:absolute;z-index:8;top:0;bottom:0;width:max(0px,min(40px,calc((100% - var(--dsh-qa-content-width)) / 2 - 48px)));cursor:col-resize;touch-action:none;user-select:none}
.dsh-qa-width-handle[data-side="left"]{right:calc(50% + var(--dsh-qa-content-width) / 2 + 24px)}
.dsh-qa-width-handle[data-side="right"]{left:calc(50% + var(--dsh-qa-content-width) / 2 + 24px)}
.dsh-qa-width-handle::after{content:"";position:absolute;top:0;bottom:0;width:3px;border-radius:3px;background:linear-gradient(to bottom,transparent calc(var(--dsh-qa-width-handle-pointer-y,50%) - 52px),var(--dsw-alias-scrollbar-hover-l1) calc(var(--dsh-qa-width-handle-pointer-y,50%) - 12px),var(--dsw-alias-scrollbar-hover-l1) calc(var(--dsh-qa-width-handle-pointer-y,50%) + 12px),transparent calc(var(--dsh-qa-width-handle-pointer-y,50%) + 52px));opacity:0;pointer-events:none}
.dsh-qa-width-handle[data-side="left"]::after{right:16px}
.dsh-qa-width-handle[data-side="right"]::after{left:16px}
.dsh-qa-width-handle:hover::after,.dsh-qa-width-handle[data-dragging]::after{opacity:1}
.dsh-qa-welcome{min-height:calc(100% - 40px);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:48px 0 88px}
.dsh-qa-welcome h2{max-width:620px;margin:0;color:var(--dsw-alias-label-primary);font-size:clamp(25px,4vw,34px);font-weight:600;line-height:1.24;letter-spacing:-.02em}
.dsh-qa-welcome p{max-width:520px;margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:21px}
.dsh-qa-message-slot{width:100%;min-width:0}
.dsh-qa-variants{display:flex;align-items:center;gap:2px;margin:-10px 0 16px}
.dsh-qa-variants button{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-variants button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-variants button:disabled{opacity:.4;cursor:default}
.dsh-qa-variants button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-1px}
.dsh-qa-variants button svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-variants span{min-width:34px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;font-variant-numeric:tabular-nums}
.dsh-qa-panel{flex:none;display:flex;flex-direction:column;width:360px;min-height:0;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dsh-qa-panel__strip{display:flex;align-items:center;gap:4px;flex:none;padding:10px 10px 8px 12px}
.dsh-qa-panel__tab{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;font-weight:500;line-height:20px;cursor:pointer}
.dsh-qa-panel__tab span{display:inline-grid;place-items:center;min-width:19px;height:18px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:400;line-height:18px}
.dsh-qa-panel__tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-panel__tab--active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-panel__tab--active span{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dsh-qa-panel__tab:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-panel__close{appearance:none;display:grid;place-items:center;width:26px;height:26px;margin-left:auto;flex:none;padding:0;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-panel__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-panel__close:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-panel__close svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round}
.dsh-qa-panel__body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.dsh-qa-sourcespanel{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.dsh-qa-sourcespanel__all{appearance:none;flex:none;align-self:flex-start;margin:2px 12px 10px 16px;padding:0;border:0;background:transparent;color:var(--dsh-qa-accent);font:inherit;font-size:12px;cursor:pointer}
.dsh-qa-sourcespanel__all:hover{text-decoration:underline}
.dsh-qa-sourcespanel__all:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-files{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 10px 12px}
.dsh-qa-files__empty{margin:12px 6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-files__group{margin:0 0 14px}
.dsh-qa-files__group h3{display:flex;align-items:center;gap:7px;margin:6px 4px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:18px}
.dsh-qa-files__jump{appearance:none;display:grid;place-items:center;width:22px;height:22px;flex:none;padding:0;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-files__jump:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-files__jump:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-files__jump svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-files__items{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.dsh-qa-files__workspace{margin:0 0 14px}
.dsh-qa-files__workspace h3{display:flex;align-items:center;gap:7px;margin:6px 4px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:18px}
.dsh-qa-ws{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-qa-ws__crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;margin:0 2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-ws__crumb{appearance:none;padding:1px 3px;border:0;border-radius:5px;background:0 0;color:var(--dsh-qa-accent);font:inherit;font-size:12px;cursor:pointer}
.dsh-qa-ws__crumb:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-ws__crumb[aria-current=true]{color:var(--dsw-alias-label-primary);font-weight:600;cursor:default}
.dsh-qa-ws__crumb:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-ws__list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.dsh-qa-ws__row{min-width:0}
.dsh-qa-ws__entry{appearance:none;display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;padding:5px 7px;border:0;border-radius:8px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;text-align:left;cursor:pointer}
.dsh-qa-ws__entry:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-ws__entry:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-ws__icon{display:grid;place-items:center;flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-ws__entry[data-kind=directory] .dsh-qa-ws__icon{color:var(--dsh-qa-accent)}
.dsh-qa-ws__icon svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-ws__name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-ws__size{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-qa-ws__status{margin:2px 6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-ws__preview{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-qa-ws__preview-head{display:flex;align-items:center;gap:7px;min-width:0}
.dsh-qa-ws__back{appearance:none;flex:none;padding:1px 3px;border:0;border-radius:5px;background:0 0;color:var(--dsh-qa-accent);font:inherit;font-size:12px;cursor:pointer}
.dsh-qa-ws__back:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-ws__back:focus-visible,.dsh-qa-ws__toggle:focus-visible,.dsh-qa-ws__download:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-ws__preview-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}
.dsh-qa-ws__download{appearance:none;flex:none;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.dsh-qa-ws__download:hover{border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.dsh-qa-ws__meta{margin:0 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-qa-ws__toggle{appearance:none;align-self:flex-start;padding:1px 3px;border:0;border-radius:5px;background:0 0;color:var(--dsh-qa-accent);font:inherit;font-size:11px;cursor:pointer}
.dsh-qa-ws__text{margin:0;padding:8px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-word}
.dsh-qa-ws__image{max-width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-ws__pdf{width:100%;height:62vh;min-height:240px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-ws__expand{appearance:none;display:grid;place-items:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-ws__expand:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-ws__expand:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-ws__expand svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-ws__expanded{display:flex;flex-direction:column;gap:8px;min-width:0}
.dsh-qa-ws__expanded .dsh-qa-ws__text{max-height:none;font-size:12px}
.dsh-qa-ws__expanded .dsh-qa-ws__pdf{height:72vh}
.dsh-qa-ws__expanded .dsh-qa-ws__image{max-height:72vh;object-fit:contain}
.dsh-qa-files__thumb{display:inline-block;width:72px;height:54px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
span.dsh-qa-files__thumb{display:inline-block}
img.dsh-qa-files__thumb{object-fit:cover;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-sources__list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 10px 12px}
.dsh-qa-sources__group{margin:0 0 14px}
.dsh-qa-sources__group h3{display:flex;align-items:center;gap:7px;margin:4px 4px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:18px}
.dsh-qa-sources__group h3 span{display:inline-grid;place-items:center;min-width:19px;height:18px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:10px}
.dsh-qa-sources__incomplete{margin:0 2px 12px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}
.dsh-qa-sources__more{appearance:none;width:100%;padding:5px;border:0;background:transparent;color:var(--dsh-qa-accent);font:inherit;font-size:12px;cursor:pointer}
.dsh-qa-sources__badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.dsh-qa-sources__badges>span{padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px}
button.dsh-qa-sources__item{display:flex;gap:10px;width:100%;margin:0 0 8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);font:inherit;text-align:left;cursor:pointer;transition:border-color .12s}
.dsh-qa-sources__kind{display:grid;place-items:center;width:18px;height:18px;flex:none;margin-top:1px;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-sources__kind svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-sources__item:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-qa-sources__item:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sources__text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsh-qa-sources__title{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:18px;text-decoration:none;text-overflow:ellipsis;white-space:nowrap}
a.dsh-qa-sources__title:hover{text-decoration:underline}
.dsh-qa-sources__target{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-sources__text p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}
.dsh-qa-sourcedetail{flex:1;min-height:0;display:flex;flex-direction:column;padding:0 10px 12px}
.dsh-qa-sourcedetail__head{display:flex;align-items:center;gap:8px;flex:none;padding:2px 2px 8px}
.dsh-qa-sourcedetail__back{display:grid;place-items:center;width:26px;height:26px;flex:none;padding:0;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-sourcedetail__back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-sourcedetail__back:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sourcedetail__back svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-sourcedetail__kind{display:grid;place-items:center;width:16px;height:16px;flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-sourcedetail__kind svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-sourcedetail__title{min-width:0;overflow:hidden;flex:1;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-sourcedetail__open{flex:none;padding:3px 10px;border:1px solid var(--dsh-qa-accent);border-radius:999px;color:var(--dsh-qa-accent);font-size:12px;font-weight:500;line-height:18px;text-decoration:none}
.dsh-qa-sourcedetail__open:hover{background:var(--dsh-qa-accent);color:var(--dsh-qa-accent-contrast)}
.dsh-qa-sourcedetail__open:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-sourcedetail__target{flex:none;margin:0 2px 8px;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-sourcedetail__body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-sourcedetail__body a{color:var(--dsh-qa-accent);text-decoration:underline}
.dsh-qa-sourcedetail__body p{margin:0}
.dsh-qa-sourcedetail__empty{margin:0;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-sourcedetail__provenance{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:10px!important;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-preview__toggle{display:flex;flex:none;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-preview__toggle button{appearance:none;padding:2px 7px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10px;line-height:16px;cursor:pointer}
.dsh-qa-preview__toggle button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsh-qa-preview__toggle button:disabled{opacity:.45;cursor:not-allowed}
.dsh-qa-preview__notice{margin:0 0 9px!important;padding:7px 9px;border-radius:7px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.dsh-qa-preview__range{display:flex;align-items:center;gap:8px;margin:0 0 9px!important;color:var(--dsw-alias-label-secondary);font-size:11px}
.dsh-qa-preview__range button{appearance:none;padding:1px 6px;border:0;background:transparent;color:var(--dsh-qa-accent);font:inherit;font-size:11px;cursor:pointer}
.dsh-qa-preview__markdown{white-space:normal;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}
/* The preview pane is a dense read-only pane: it keeps its own scale instead
   of the transcript's ladder, one step tighter in every block. */
.dsh-qa-preview__markdown .dsh-qa-md{font-size:13px;line-height:1.6}
.dsh-qa-preview__markdown .dsh-qa-md :where(p,ul,ol,blockquote,.dsh-qa-md-code,.dsh-qa-md-table){margin:0 0 10px}
.dsh-qa-preview__markdown .dsh-qa-md :where(h1,h2,h3,h4,h5,h6){margin:14px 0 8px;font-size:15px;line-height:1.4}
.dsh-qa-preview__raw{max-width:100%;margin:0;overflow:auto;white-space:pre;background:var(--dsw-alias-bg-layer-3);font:11px/18px ui-monospace,SFMono-Regular,Consolas,monospace}
.dsh-qa-preview__raw code{display:block;min-width:max-content}
.dsh-qa-preview__line{display:flex;min-height:18px}
.dsh-qa-preview__line--highlight{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-preview__number{width:46px;flex:none;padding-right:10px;color:var(--dsw-alias-label-tertiary);text-align:right;user-select:none}
.dsh-qa-message{display:flex;flex-direction:column;width:100%;min-width:0;margin:0 0 20px}
.dsh-qa-message--user{align-items:flex-end;margin-left:auto}
.dsh-qa-message--assistant{align-items:flex-start;margin-right:auto}
.dsh-qa-message--work{align-items:flex-start;margin:-4px 0 14px}
.dsh-qa-message--system{align-items:center;margin:4px auto 20px}
.dsh-qa-message__content{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.62}
.dsh-qa-message--user .dsh-qa-message__content{max-width:min(525px,82%);padding:10px 16px;border-radius:22px;background:var(--dsw-specific-bubble);font-size:16px;line-height:24px}
.dsh-qa-message[data-status="pending"] .dsh-qa-message__content{opacity:.78}
.dsh-qa-message__pending{display:flex;align-items:center;gap:6px;margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-qa-message__pending-spinner{width:11px;height:11px;flex:none;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:dsh-qa-spin .9s linear infinite}
.dsh-qa-message__byline{display:block;margin-bottom:2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;font-weight:500}
.dsh-qa-message__images{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
.dsh-qa-message__files{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
.dsh-qa-message--user .dsh-qa-message__files{justify-content:flex-end}
.dsh-qa-message__files .dsh-qa-file{background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-message--user .dsh-qa-message__images{justify-content:flex-end}
.dsh-qa-message__image{display:block;width:132px;height:96px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);object-fit:cover;background:var(--dsw-alias-bg-layer-2)}
a.dsh-qa-message__image{padding:0}
span.dsh-qa-message__image{display:grid;place-items:center;color:var(--dsw-alias-label-tertiary);font-size:11px}
span.dsh-qa-message__image[data-state="broken"]::after{content:"Не удалось загрузить"}
span.dsh-qa-message__image[data-state="loading"]{animation:dsh-qa-spin 1.2s linear infinite;border-style:dashed}
.dsh-qa-message--assistant .dsh-qa-message__content{width:100%;padding:2px 0}
.dsh-qa-message__sources{appearance:none;margin-top:10px;padding:4px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-qa-message__sources:hover{border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.dsh-qa-message__sources:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-message--system .dsh-qa-message__content{padding:7px 11px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-qa-message[data-status="info"] .dsh-qa-message__content{color:var(--dsh-qa-info)}
.dsh-qa-message[data-status="error"] .dsh-qa-message__content{color:var(--dsh-qa-error)}
.dsh-qa-message__actions{display:flex;align-items:center;gap:8px;height:28px;margin-top:6px;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-message--user .dsh-qa-message__actions{justify-content:flex-end}
.dsh-qa-message__actions button{display:grid;place-items:center;width:28px;height:28px;padding:5px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-message__actions button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsh-qa-message__actions button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-message__actions svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-message__actions button[data-active]{color:var(--dsh-qa-accent)}
.dsh-qa-message__actions button[data-active]:hover{color:var(--dsh-qa-accent)}
.dsh-qa-message__meta{display:flex;align-items:center;gap:12px;min-width:0;padding:0 8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;white-space:nowrap}
.dsh-qa-rail{position:sticky;top:0;z-index:7;height:0;pointer-events:none}.dsh-qa-rail__frame{--dsh-qa-rail-band:320px;--dsh-qa-rail-natural:0px;--dsh-qa-rail-inset:6px;--dsh-qa-rail-scroll-top:0px;--dsh-qa-rail-preview-height:100px;position:absolute;top:calc(var(--dsh-qa-rail-band)/2);right:12px;width:28px;height:min(var(--dsh-qa-rail-natural),max(0px,calc(var(--dsh-qa-rail-band) - 64px)),420px);cursor:pointer;pointer-events:auto;transform:translateY(-50%);transition:height 220ms cubic-bezier(.2,.8,.2,1)}
.dsh-qa-rail__scroll{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
.dsh-qa-rail__scroll::-webkit-scrollbar{display:none}
.dsh-qa-rail__scroll--fade-top{mask-image:linear-gradient(to bottom,transparent 0,#000 24px,#000 100%)}
.dsh-qa-rail__scroll--fade-bottom{mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 24px),transparent 100%)}
.dsh-qa-rail__scroll--fade-top.dsh-qa-rail__scroll--fade-bottom{mask-image:linear-gradient(to bottom,transparent 0,#000 24px,#000 calc(100% - 24px),transparent 100%)}
.dsh-qa-rail__marks{position:relative;height:var(--dsh-qa-rail-natural)}
.dsh-qa-rail__pos{position:absolute;top:calc(var(--dsh-qa-rail-pos) + var(--dsh-qa-rail-inset));right:0;left:0;height:10px;transform:translateY(-50%);transition:top 220ms cubic-bezier(.2,.8,.2,1);animation:dsh-qa-rail-enter 150ms ease-out}
.dsh-qa-rail__mark{position:absolute;inset:0 0 0 auto;width:20px;padding:0;border:0;border-radius:8px;background:transparent;cursor:pointer;pointer-events:none}
.dsh-qa-rail__mark::before{position:absolute;top:50%;right:0;width:12px;height:2px;border-radius:2px;background:var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));content:"";transform:translateY(-50%);transition:width 140ms ease,background-color 140ms ease}
.dsh-qa-rail__mark--preview::before{width:18px;background:var(--dsw-alias-label-tertiary)}
.dsh-qa-rail__mark--busy::before{animation:dsh-qa-rail-busy 1s ease-in-out infinite}
.dsh-qa-rail__mark--active::before{width:20px;background:var(--dsw-alias-label-primary)}
.dsh-qa-rail__mark:focus-visible{outline:1px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-rail__mark:focus-visible::before{width:20px;background:var(--dsh-qa-accent)}
.dsh-qa-rail__preview{position:absolute;top:clamp(0px,calc(var(--dsh-qa-rail-pos) + var(--dsh-qa-rail-inset) - var(--dsh-qa-rail-scroll-top) - var(--dsh-qa-rail-preview-height)/2),calc(100% - var(--dsh-qa-rail-preview-height)));right:calc(100% + 10px);box-sizing:border-box;width:min(300px,60vw);max-height:var(--dsh-qa-rail-preview-height);overflow:hidden;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv2);pointer-events:none;animation:dsh-qa-rail-preview-enter 120ms ease-out;transition:top 140ms cubic-bezier(.2,.8,.2,1)}
.dsh-qa-rail__preview-prompt,.dsh-qa-rail__preview-response{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical}
.dsh-qa-rail__preview-prompt{font-size:13px;font-weight:600;line-height:18px;-webkit-line-clamp:1}
.dsh-qa-rail__preview-response{margin-top:4px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));font-size:12px;line-height:17px;-webkit-line-clamp:3}
@keyframes dsh-qa-rail-enter{from{opacity:0}to{opacity:1}}
@keyframes dsh-qa-rail-preview-enter{from{opacity:0;transform:translateX(4px)}to{opacity:1;transform:translateX(0)}}
@keyframes dsh-qa-rail-busy{0%,100%{opacity:1}50%{opacity:.35}}
@media (max-width:900px){.dsh-qa-rail{display:none}}
.dsh-qa-srcref{position:relative;display:inline-flex;align-items:center;gap:5px;max-width:320px;margin:0 1px;padding:2px 9px 2px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;font-weight:500;text-decoration:none;vertical-align:baseline;cursor:pointer;transition:border-color .12s,color .12s}
a.dsh-qa-srcref:hover,button.dsh-qa-srcref:hover{border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.dsh-qa-srcref:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-srcref__icon{display:grid;place-items:center;width:14px;height:14px;flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-srcref__icon svg{width:13px;height:13px;display:block;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-srcref__label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-srcref__card{position:absolute;top:calc(100% + 6px);left:0;z-index:9;display:none;width:min(320px,calc(100vw - 48px));padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px;font-weight:400;text-align:left;white-space:normal;cursor:default}
.dsh-qa-srcref:hover .dsh-qa-srcref__card,.dsh-qa-srcref:focus-visible .dsh-qa-srcref__card{display:block}
.dsh-qa-srcref__card-title{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-srcref__card-target{display:block;overflow:hidden;margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-srcref__card-snippet{display:-webkit-box;overflow:hidden;margin-top:6px;color:var(--dsw-alias-label-secondary);-webkit-box-orient:vertical;-webkit-line-clamp:3}

/* Markdown typography follows the host transcript's own ladder: the sizes,
   weights, and margins below are the ones DSH gives assistant prose, read
   from the theme's --dsw-font-markdown-* / --dsw-alias-markdown-* custom
   properties, so a font-size preference or a light/dark switch moves both
   surfaces together. A container that needs a denser scale (the source
   preview, the work-item text) overrides the ladder for its own subtree. */
.dsh-qa-md{min-width:0;white-space:normal;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-markdown-base-font-family,inherit);font-size:var(--dsw-font-markdown-base-font-size,14px);font-weight:400;line-height:var(--dsw-font-markdown-base-line-height,24px)}
.dsh-qa-md>:first-child{margin-top:0}
.dsh-qa-md>:last-child{margin-bottom:0}
.dsh-qa-md p{margin:16px 0}
.dsh-qa-md strong{font-weight:600}
.dsh-qa-md h1{margin:32px 0 16px;font-size:var(--dsw-font-markdown-h1-font-size,21px);font-weight:700;line-height:var(--dsw-font-markdown-h1-line-height,30px)}
.dsh-qa-md h2{margin:32px 0 16px;font-size:var(--dsw-font-markdown-h2-font-size,19px);font-weight:700;line-height:var(--dsw-font-markdown-h2-line-height,28px)}
.dsh-qa-md h3{margin:32px 0 16px;font-size:var(--dsw-font-markdown-h3-font-size,18px);font-weight:700;line-height:var(--dsw-font-markdown-h3-line-height,26px)}
.dsh-qa-md h4,.dsh-qa-md h5,.dsh-qa-md h6{margin:16px 0;font-size:var(--dsw-font-markdown-base-font-size,14px);font-weight:600;line-height:var(--dsw-font-markdown-base-line-height,24px)}
.dsh-qa-md h1 strong,.dsh-qa-md h2 strong,.dsh-qa-md h3 strong,.dsh-qa-md h4 strong,.dsh-qa-md h5 strong,.dsh-qa-md h6 strong{font-weight:inherit}
.dsh-qa-md h4+ol,.dsh-qa-md h4+ul,.dsh-qa-md h5+ol,.dsh-qa-md h5+ul,.dsh-qa-md h6+ol,.dsh-qa-md h6+ul{margin-top:8px}
.dsh-qa-md a{position:relative;color:var(--dsh-qa-accent);font-weight:500;text-decoration:none}
.dsh-qa-md a:hover,.dsh-qa-md a:focus-visible{text-decoration:underline dotted var(--dsh-qa-accent);text-underline-offset:3px;outline:none}
.dsh-qa-md-link-icon{width:1.05em;height:1.05em;flex:none;margin-right:5px;vertical-align:-.18em;fill:none;stroke:currentColor;stroke-width:1.15;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-md ol,.dsh-qa-md ul{margin:16px 0;padding-left:22px}
.dsh-qa-md li{margin-top:6px}
.dsh-qa-md li>:first-child{margin-top:0}
.dsh-qa-md li>:last-child{margin-bottom:0}
.dsh-qa-md li::marker{color:var(--dsw-alias-label-secondary)}
.dsh-qa-md li>ol,.dsh-qa-md li>ul{margin-top:4px}
.dsh-qa-md :where(ol,ul) ol{list-style-position:inside;padding-left:0}
.dsh-qa-md .dsh-qa-md-task{list-style:none}
.dsh-qa-md .dsh-qa-md-task input{margin:0 8px 0 0;accent-color:var(--dsw-alias-label-secondary)}
.dsh-qa-md hr{height:.5px;margin:32px 0;border:0;background:var(--dsw-alias-border-l2)}
.dsh-qa-md blockquote{margin:16px 0;padding-left:14px;border-left:2px solid var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));color:var(--dsw-alias-label-secondary)}
.dsh-qa-md :not(pre)>code{display:inline-flex;align-items:center;box-sizing:border-box;padding:0 5px;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-markdown-inline-code,var(--dsw-alias-bg-layer-2));font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:.875em;line-height:19px}
.dsh-qa-md h1 code,.dsh-qa-md h2 code,.dsh-qa-md h3 code,.dsh-qa-md h4 code,.dsh-qa-md h5 code,.dsh-qa-md h6 code{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:inherit}
.dsh-qa-md-image{display:block;max-width:100%;height:auto;margin:0;border-radius:8px}
.dsh-qa-md-image-alt{color:var(--dsw-alias-label-tertiary);font-style:italic}
.dsh-qa-md-code{margin:16px 0;border-radius:12px;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}
.dsh-qa-md-code__banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 14px;border-radius:12px 12px 0 0;background:var(--dsw-alias-markdown-code-block-banner,var(--dsw-alias-bg-layer-3))}
.dsh-qa-md-code__lang{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-md-code__copy{appearance:none;flex:none;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:18px;cursor:pointer}
.dsh-qa-md-code__copy:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-md-code__copy:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-md-code pre{overflow-x:auto;margin:0;padding:16px;border:0;border-radius:0 0 12px 12px;background:transparent;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:var(--dsw-font-markdown-code-block-font-size,11px);line-height:var(--dsw-font-markdown-code-block-line-height,19px);white-space:pre-wrap;word-break:break-word}
.dsh-qa-md-code pre code{display:block;padding:0;border:0;background:transparent;font:inherit}
.dsh-qa-md-tok[data-tok="comment"]{color:var(--shiki-token-comment)}
.dsh-qa-md-tok[data-tok="string"]{color:var(--shiki-token-string)}
.dsh-qa-md-tok[data-tok="keyword"]{color:var(--shiki-token-keyword)}
.dsh-qa-md-tok[data-tok="number"]{color:var(--shiki-token-constant)}
.dsh-qa-md-tok[data-tok="constant"]{color:var(--shiki-token-constant)}
.dsh-qa-md-tok[data-tok="meta"]{color:var(--shiki-token-parameter)}
.dsh-qa-md-tok[data-tok="tag"]{color:var(--shiki-token-keyword)}
.dsh-qa-md-tok[data-tok="attr"]{color:var(--shiki-token-parameter)}
.dsh-qa-md-tok[data-tok="key"]{color:var(--shiki-token-function)}
.dsh-qa-md-tok[data-tok="insert"]{color:var(--dsh-qa-success)}
.dsh-qa-md-tok[data-tok="delete"]{color:var(--dsh-qa-error)}
.dsh-qa-md-tok[data-tok="hunk"]{color:var(--shiki-token-function)}
.dsh-qa-md-table{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;margin:0 0 14px}
.dsh-qa-md-table table{border-collapse:collapse;width:max-content;font-size:var(--dsw-font-markdown-table-font-size,14px)}
.dsh-qa-md-table th,.dsh-qa-md-table td{max-width:max(160px,calc(var(--dsh-qa-content-width,920px)*0.35));border:1px solid var(--dsw-alias-border-l2);padding:6px 10px;vertical-align:top;overflow-wrap:anywhere}
.dsh-qa-md-table thead th{background:var(--dsw-alias-bg-layer-2);font-weight:600}
.dsh-qa-md-table tbody tr:nth-child(even){background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-md-math{overflow-x:auto;overflow-y:hidden;margin:16px 0;text-align:center}
.dsh-qa-md-math .katex-display{margin:0}
.dsh-qa-md-fn-ref{margin:0 1px;font-size:.8em;line-height:0;vertical-align:super}
.dsh-qa-md-footnotes{margin:20px 0 0;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:.9em}
.dsh-qa-md-footnotes ol{margin:0;padding-left:22px}
.dsh-qa-md-footnotes li{margin-top:4px}
.dsh-qa-md-footnotes li>:first-child{margin-top:0}
.dsh-qa-md-footnotes sup{margin:0 1px;font-size:.8em;line-height:0;vertical-align:super}
.dsh-qa-message--assistant .dsh-qa-message__content .dsh-qa-md-code{width:calc(100% + var(--dsh-qa-bleed)*2);margin-right:calc(var(--dsh-qa-bleed)*-1);margin-left:calc(var(--dsh-qa-bleed)*-1)}
.dsh-qa-message__cursor{display:inline-block;width:7px;height:1em;margin-left:3px;vertical-align:-2px;background:var(--dsw-alias-label-secondary);animation:dsh-qa-blink 1s steps(2,start) infinite}
@keyframes dsh-qa-blink{50%{opacity:0}}
.dsh-qa-notice{width:100%;min-width:0;margin:-4px 0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-notice__summary{display:flex;align-items:center;gap:7px;min-height:32px;padding:4px 10px;list-style:none;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}
.dsh-qa-notice__summary::-webkit-details-marker{display:none}
.dsh-qa-notice__summary:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-notice__summary:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-notice__icon{width:15px;height:15px;flex:none;fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-notice__title{flex:1;min-width:0;overflow:hidden;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-notice__chevron{width:13px;height:13px;flex:none;fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round;transition:transform .16s ease}
.dsh-qa-notice[open] .dsh-qa-notice__chevron{transform:rotate(90deg)}
.dsh-qa-notice__body{padding:2px 12px 10px 32px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-notice__body p{margin:0}
.dsh-qa-notice__body .dsh-qa-md{font-size:13px;line-height:20px;white-space:pre-wrap}
.dsh-qa-notice__meta{margin:0 0 6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;white-space:pre-line;overflow-wrap:anywhere}
.dsh-qa-work{width:100%;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.dsh-qa-work__toggle{display:flex;align-items:center;gap:7px;min-height:30px;margin:0;padding:3px 5px 3px 0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dsh-qa-work__toggle:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-work[data-state="error"] .dsh-qa-work__toggle{color:var(--dsh-qa-error)}
.dsh-qa-work[data-state="error"] .dsh-qa-work__toggle:hover{color:var(--dsh-qa-error)}
.dsh-qa-work__toggle:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
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
.dsh-qa-work-tool>summary:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-1px}
.dsh-qa-work-item__icon{display:grid;place-items:center;width:16px;height:16px;flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-work-item__icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-work-item__icon[data-state="ok"]{color:var(--dsh-qa-success,var(--dsw-alias-label-secondary))}
.dsh-qa-work-item__icon[data-state="error"]{color:var(--dsh-qa-error)}
.dsh-qa-work-item__label{flex:none;color:var(--dsw-alias-label-secondary);font-weight:500}
.dsh-qa-work-item__summary{min-width:0;overflow:hidden;flex:1;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap}.dsh-qa-work-item__agent-id{flex:none;padding:1px 6px;border-radius:999px;background:var(--dsh-qa-info10);color:var(--dsh-qa-info);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;line-height:15px}.dsh-qa-work-tool[data-tool="subagent"],.dsh-qa-work-item[data-tool="subagent"]{border:1px solid var(--dsh-qa-info30);border-radius:9px}
.dsh-qa-work-item--text{padding:5px 6px 9px}
.dsh-qa-work-item__text-head{display:flex;align-items:center;gap:7px;min-height:24px}
.dsh-qa-work-item__text{padding:3px 0 0 23px;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:23px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-work-item__text p,.dsh-qa-work-item__text ul,.dsh-qa-work-item__text pre{margin:0 0 9px}
.dsh-qa-work-item__text :last-child{margin-bottom:0}
/* Reasoning keeps its authored line breaks: the process log reads as the
   model wrote it, not as reflowed prose. */
.dsh-qa-work-item__text .dsh-qa-md{font-size:14px;line-height:23px;white-space:pre-wrap}
.dsh-qa-work-tool__body{margin:0 6px 7px 29px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-work-tool__body section+section{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-work-tool__body section>span{display:block;padding:7px 10px 0;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:18px;text-transform:uppercase;letter-spacing:.04em}
.dsh-qa-work-tool__body pre{max-height:260px;overflow:auto;margin:0;padding:7px 10px 10px;color:var(--dsw-alias-label-secondary);background:transparent;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:19px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-error{display:flex;align-items:center;justify-content:center;gap:10px;margin:16px auto;padding:10px 12px;border:1px solid var(--dsh-qa-error);border-radius:10px;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-qa-compatibility{margin:16px auto;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:19px}
.dsh-qa-error button{border:0;background:transparent;color:var(--dsh-qa-accent);font:inherit;font-weight:600;cursor:pointer}
.dsh-qa-approvals{display:flex;flex-direction:column;gap:8px;width:100%;margin-bottom:10px}
.dsh-qa-approval{padding:12px 14px;border:1px solid var(--dsh-qa-warning30);border-radius:12px;background:var(--dsh-qa-warning10)}
.dsh-qa-approval__strip{display:flex;align-items:center;gap:7px;margin:0 0 8px;color:var(--dsh-qa-warning-hover);font-size:12px;font-weight:600;line-height:16px}
.dsh-qa-approval__dot{width:7px;height:7px;flex:none;border-radius:999px;background:var(--dsh-qa-warning)}
.dsh-qa-approval__reason{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;overflow-wrap:anywhere}
.dsh-qa-approval__tool{margin:6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-qa-approval__tool code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
.dsh-qa-approval__delegated{color:var(--dsw-alias-label-tertiary);font-weight:400;margin-left:6px}
.dsh-qa-approval__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.dsh-qa-approval__button{appearance:none;padding:7px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;line-height:18px;cursor:pointer}
.dsh-qa-approval__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-approval__button:disabled{opacity:.5;cursor:default}
.dsh-qa-approval__button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-approval__button--primary{border-color:transparent;background:var(--dsh-qa-accent);color:var(--dsh-qa-accent-contrast)}
.dsh-qa-approval__button--primary:hover:not(:disabled){background:var(--dsh-qa-accent-hover)}
.dsh-qa-questions{display:flex;flex-direction:column;gap:8px;width:100%;margin-bottom:10px}
.dsh-qa-question{padding:12px 14px;border:1px solid var(--dsh-qa-info30);border-radius:12px;background:var(--dsh-qa-info10)}
.dsh-qa-question__strip{display:flex;align-items:center;gap:7px;margin:0 0 8px;color:var(--dsh-qa-info);font-size:12px;font-weight:600;line-height:16px}
.dsh-qa-question__dot{width:7px;height:7px;flex:none;border-radius:999px;background:var(--dsh-qa-info)}
.dsh-qa-question__count{margin-left:auto;font-weight:500;color:var(--dsh-qa-info)}
.dsh-qa-question__header{margin:0 0 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;line-height:16px}
.dsh-qa-question__fieldset{display:flex;flex-direction:column;gap:8px;min-width:0;margin:0;padding:0;border:0}
.dsh-qa-question__text{margin:0;padding:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:19px;overflow-wrap:anywhere}
.dsh-qa-question__detail{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}
.dsh-qa-question__options{display:flex;flex-direction:column;gap:6px}
.dsh-qa-question__option{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
.dsh-qa-question__option[data-checked="true"]{border-color:var(--dsh-qa-info);background:color-mix(in srgb,var(--dsh-qa-info) 8%,var(--dsw-alias-bg-layer-2))}
.dsh-qa-question__option input{margin:2px 0 0;accent-color:var(--dsh-qa-info)}
.dsh-qa-question__option-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-qa-question__option-label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;overflow-wrap:anywhere}
.dsh-qa-question__option-description{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;overflow-wrap:anywhere}
.dsh-qa-question__custom{display:flex;flex-direction:column;gap:4px}
.dsh-qa-question__custom span{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-qa-question__custom textarea{width:100%;resize:vertical;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:19px}
.dsh-qa-question__custom textarea:focus-visible{outline:2px solid var(--dsh-qa-info);outline-offset:1px}
.dsh-qa-question__fieldset:disabled{opacity:.6}
.dsh-qa-question__error{margin:0;color:var(--dsh-qa-error);font-size:12px;line-height:17px}
.dsh-qa-question__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.dsh-qa-question__button{appearance:none;padding:7px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;line-height:18px;cursor:pointer}
.dsh-qa-question__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-question__button:disabled{opacity:.5;cursor:default}
.dsh-qa-question__button:focus-visible{outline:2px solid var(--dsh-qa-info);outline-offset:1px}
.dsh-qa-question__button--primary{border-color:transparent;background:var(--dsh-qa-accent);color:var(--dsh-qa-accent-contrast)}
.dsh-qa-question__button--primary:hover:not(:disabled){background:var(--dsh-qa-accent-hover)}
.dsh-qa-questions__bar{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-qa-questions__note{min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-qa-question__button--stop{display:inline-flex;align-items:center;gap:6px;flex:none}
.dsh-qa-question__button--stop svg{width:13px;height:13px;flex:none;fill:currentColor}
.dsh-qa-composer-slot[hidden]{display:none}
.dsh-qa-footer{position:relative;flex:none;padding:28px 16px max(12px,env(safe-area-inset-bottom));background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-base) 0%,transparent) 0,var(--dsw-alias-bg-base) 28px)}
.dsh-qa-footer__inner{width:100%;max-width:var(--dsh-qa-content-width);margin:0 auto}
.dsh-qa-composer-wrap{display:flex;flex-direction:column;gap:10px;width:100%}
.dsh-qa-footer__disclaimer{display:flex;align-items:flex-start;justify-content:center;gap:6px;margin:10px auto 0;max-width:640px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:left}
.dsh-qa-footer__disclaimer svg{width:13px;height:13px;flex:none;margin-top:1px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round}
.dsh-qa-quick-questions{display:flex;gap:8px;width:100%;padding:2px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}
.dsh-qa-quick-questions button{flex:none;max-width:min(360px,80vw);padding:8px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.dsh-qa-quick-questions button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-quick-questions button:disabled{opacity:.5;cursor:default}
.dsh-qa-quick-questions button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-composer-wrap--drag .dsh-qa-composer{border-color:var(--dsh-qa-accent);border-style:dashed;background:color-mix(in srgb,var(--dsh-qa-accent) 6%,var(--dsw-specific-input-major))}
.dsh-qa-composer__images{display:flex;flex-wrap:wrap;gap:8px}
.dsh-qa-composer__files{display:flex;flex-wrap:wrap;gap:8px}
.dsh-qa-file{display:flex;align-items:center;gap:10px;max-width:280px;min-width:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-file__badge{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:9px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:700;letter-spacing:.02em}
.dsh-qa-file__text{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsh-qa-file__name{color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-file__meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-qa-file button{display:grid;place-items:center;flex:none;width:18px;height:18px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-file button:hover{color:var(--dsh-qa-error)}
.dsh-qa-file button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-file button svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round}
.dsh-qa-composer__image{position:relative;display:block;width:64px;height:64px;flex:none}
.dsh-qa-composer__image img{display:block;width:100%;height:100%;object-fit:cover;border-radius:10px;border:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-composer__image button{position:absolute;top:-6px;right:-6px;display:grid;place-items:center;width:18px;height:18px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;box-shadow:var(--dsw-shadow-lv2)}
.dsh-qa-composer__image button:hover{color:var(--dsh-qa-error)}
.dsh-qa-composer__image button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-composer__image button svg{width:9px;height:9px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round}
.dsh-qa-composer__attachment-error{margin:0;color:var(--dsh-qa-error);font-size:12px;line-height:18px}
.dsh-qa-composer__attach{display:grid;place-items:center;flex:none;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-composer__attach:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-composer__attach:disabled{opacity:.4;cursor:default}
.dsh-qa-composer__attach:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
.dsh-qa-composer__attach svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-slash{display:flex;flex-direction:column;gap:2px;width:100%;max-height:min(46vh,320px);overflow-y:auto;overscroll-behavior:contain;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv2)}
.dsh-qa-slash__empty,.dsh-qa-slash__hint{margin:0;padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-qa-slash__group{display:flex;flex-direction:column;gap:2px}
.dsh-qa-slash__group-title{margin:6px 0 2px;padding:0 10px;color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.dsh-qa-slash__row{display:flex;flex-direction:column;gap:2px;min-width:0;padding:7px 10px;border-radius:10px;cursor:pointer}
.dsh-qa-slash__row--active{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-slash__head{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-qa-slash__name{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-slash__kind{flex:none;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:500;line-height:15px}
.dsh-qa-slash__kind--command{background:color-mix(in srgb,var(--dsh-qa-accent) 16%,var(--dsw-alias-bg-module-platform))}
.dsh-qa-slash__description{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-command{display:flex;flex-direction:column;gap:3px;margin:0 0 14px;padding:8px 12px;border-left:2px solid var(--dsw-alias-border-l2);border-radius:0 10px 10px 0;background:var(--dsw-alias-bg-layer-3)}
.dsh-qa-command[data-state="error"]{border-left-color:var(--dsh-qa-error)}
.dsh-qa-command__line{display:flex;align-items:baseline;gap:8px;min-width:0}
.dsh-qa-command__name{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;line-height:18px}
.dsh-qa-command__args{color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-command__state{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;overflow-wrap:anywhere}
.dsh-qa-command__state svg{flex:none;width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-command[data-state="success"] .dsh-qa-command__state svg{stroke:var(--dsh-qa-accent)}
.dsh-qa-command[data-state="error"] .dsh-qa-command__state{color:var(--dsh-qa-error)}
.dsh-qa-command__spinner{flex:none;width:11px;height:11px;border:1.5px solid var(--dsw-alias-label-dimmed);border-top-color:var(--dsh-qa-accent);border-radius:999px;animation:dsh-qa-command-spin .7s linear infinite}
@keyframes dsh-qa-command-spin{to{transform:rotate(360deg)}}
.dsh-qa-composer{display:flex;flex-direction:column;gap:10px;width:100%;min-height:94px;padding:14px 10px 8px 16px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);border-radius:22px;background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);transition:border-color .12s,box-shadow .12s}
.dsh-qa-composer:focus-within{border-color:var(--dsh-qa-accent)}
.dsh-qa-composer textarea{display:block;width:100%;min-height:28px;max-height:168px;resize:none;overflow-y:auto;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:16px;line-height:24px;padding:0 6px 0 0;caret-color:var(--dsh-qa-accent)}
.dsh-qa-composer textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-composer textarea:disabled{cursor:default}
.dsh-qa-composer__toolbar{display:flex;align-items:center;min-height:34px;gap:12px}
.dsh-qa-composer__hint{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-caption);font-size:11px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-composer__action{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:0;border-radius:999px;color:var(--dsh-qa-accent-contrast);cursor:pointer}
.dsh-qa-composer__action svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-composer__action--send{background:var(--dsh-qa-accent)}
.dsh-qa-composer__action--send:hover:not(:disabled){background:var(--dsh-qa-accent-hover)}
.dsh-qa-composer__action--stop{background:var(--dsh-qa-error)}
.dsh-qa-composer__action--stop svg{fill:currentColor;stroke:none}
.dsh-qa-composer__action:disabled{opacity:.4;cursor:default}
.dsh-qa-composer__action:focus-visible,.dsh-qa-error button:focus-visible,.dsh-qa-header__reset:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
@media (hover:hover){.dsh-qa-message__actions .dsh-qa-message__meta{opacity:0;transition:opacity 80ms ease}.dsh-qa-message:hover .dsh-qa-message__actions .dsh-qa-message__meta,.dsh-qa-message:focus-within .dsh-qa-message__actions .dsh-qa-message__meta,.dsh-qa-message__actions[data-persistent] .dsh-qa-message__meta{opacity:1}}.dsh-qa-message__actions[data-persistent] .dsh-qa-message__meta{opacity:1}
@media (max-width:760px){.dsh-qa-admin__header{min-height:56px;padding:8px 14px}.dsh-qa-admin__layout{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.dsh-qa-admin__layout>nav{flex-direction:row;overflow-x:auto;padding:8px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-qa-admin__layout>nav strong{display:none}.dsh-qa-admin__layout>nav button{white-space:nowrap}.dsh-qa-admin__content,.dsh-qa-role-editor{padding:20px 14px 76px}.dsh-qa-admin__title-row{flex-direction:column}.dsh-qa-role-grid{grid-template-columns:1fr}.dsh-qa-role-editor__general{grid-template-columns:1fr}.dsh-qa-skill-detail__grid{grid-template-columns:1fr}.dsh-qa-role-editor__wide{grid-column:auto}.dsh-qa-admin__savebar{bottom:-76px;margin:24px -14px -76px;padding:10px 14px}.dsh-qa-admin__savebar>span{display:none}.dsh-qa-audit li{grid-template-columns:1fr 1fr}.dsh-qa-capabilities__toolbar{align-items:stretch;flex-direction:column}.dsh-qa-capabilities__toolbar>input{width:100%}}
@media (max-width:600px){.dsh-qa-sidebar{display:none}.dsh-qa-panel,.dsh-qa-agents{position:absolute;inset:0;z-index:6;width:100%;border-left:0}.dsh-qa-header__inner{padding-left:16px;padding-right:16px}.dsh-qa-header h1{max-width:48vw}.dsh-qa-width-handle{display:none}.dsh-qa-transcript__inner{--dsh-qa-bleed:0px;max-width:100%;padding:16px 16px 28px}.dsh-qa-footer__inner{max-width:100%}.dsh-qa-message{margin-bottom:16px}.dsh-qa-message--user .dsh-qa-message__content{max-width:88%;font-size:15px}.dsh-qa-message__content{font-size:14px}.dsh-qa-footer{padding-left:10px;padding-right:10px;padding-bottom:max(8px,env(safe-area-inset-bottom))}.dsh-qa-composer{min-height:84px;padding-top:12px}.dsh-qa-composer__hint{font-size:0}.dsh-qa-composer__hint::after{content:"Enter: отправить";font-size:11px}}
@media (max-height:480px) and (orientation:landscape){.dsh-qa-header__inner{padding-top:6px}.dsh-qa-header__tabs{display:none}.dsh-qa-transcript__inner{padding-top:12px}.dsh-qa-footer{padding-top:12px}.dsh-qa-composer{min-height:72px;gap:4px;padding-top:8px}}
@media (prefers-reduced-motion:reduce){.dsh-qa-message__cursor,.dsh-qa-message__pending-spinner,.dsh-qa-work__spinner,.dsh-qa-work-item__spinner,.dsh-qa-command__spinner{animation:none}.dsh-qa-work__chevron{transition:none}.dsh-qa-rail__frame,.dsh-qa-rail__pos,.dsh-qa-rail__mark::before,.dsh-qa-rail__mark--busy::before,.dsh-qa-rail__preview{transition:none;animation:none}}
${QA_ADMIN_CONSOLE_STYLES}
`;

/**
 * Everything the QA surface paints, as one sheet for one `<style>` tag — the
 * kiosk form, with no host-hiding rules: in the kiosk composition the native
 * shell never mounts, so the sheet carries nothing aimed at it.
 *
 * The shared audit components keep their own stylesheet in
 * `@yadsh/dsh-audit-ui`; it is folded in here so the surface is self-contained
 * — the audit dialog must look right whether or not the audit plugin's own
 * client bundle happens to have injected the same rules into the document.
 *
 * The math styles and their fonts come from the bundled KaTeX copy the same
 * way: the data-URI fonts resolve whatever the Host page loads, and identical
 * rules from its own KaTeX stylesheet are harmless.
 */
export const QA_ROOT_STYLES = `${QA_SURFACE_STYLES}
${KATEX_CSS}
${AUDIT_UI_STYLES}`;

/**
 * The overlay-composition sheet: the same rules as {@link QA_ROOT_STYLES}
 * plus the host-column mask. Deployed into hosts without the kiosk patches,
 * where the surface still covers a mounted native shell and the mask is what
 * a deleted overlay element uncovers — a blank page instead of the shell.
 */
export const QA_OVERLAY_STYLES = `${QA_HOST_COLUMN_MASK_RULE}
${QA_ROOT_STYLES}`;
