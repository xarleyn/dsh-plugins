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
} as const;

const QA_BRAND_TOKENS = Object.entries(QA_BRAND_PALETTE)
  .map(
    ([token, value]) =>
      `--dsh-qa-${token.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}:${value}`,
  )
  .join(";");

export const QA_SURFACE_STYLES = String.raw`
.dsh-qa-surface{${QA_BRAND_TOKENS};position:fixed;inset:0;z-index:2147483000;pointer-events:auto;display:flex;flex-direction:row;min-width:0;height:100vh;height:100dvh;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit}
.dsh-qa-body{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.dsh-qa-sidebar{flex:none;width:264px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dsh-qa-sidebar--collapsed{width:52px;align-items:center;padding-top:12px}
.dsh-qa-sidebar__head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex:none;padding:14px 10px 10px 16px}
.dsh-qa-sidebar__brand{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-qa-sidebar__logo{display:grid;place-items:center;width:24px;height:24px;flex:none;color:var(--dsh-qa-brand)}
.dsh-qa-sidebar__logo svg,.dsh-qa-sidebar__logo img{width:24px;height:24px;display:block;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
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
.dsh-qa-sidebar__search svg{position:absolute;top:7px;left:22px;width:14px;height:14px;fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.dsh-qa-sidebar__search input{display:block;width:100%;padding:7px 10px 7px 32px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;-webkit-appearance:none;appearance:none}
.dsh-qa-sidebar__search input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-qa-sidebar__search input:focus{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px;border-color:transparent}
.dsh-qa-sidebar__list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 8px 12px}
.dsh-qa-sidebar__empty{margin:8px 8px 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px}
.dsh-qa-sidebar__item{display:flex;align-items:center;gap:2px;width:100%;padding:2px;border-radius:8px}
.dsh-qa-sidebar__item:hover,.dsh-qa-sidebar__item--active{background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-sidebar__item-main{appearance:none;display:flex;align-items:center;gap:8px;flex:1;min-width:0;border:0;background:0 0;cursor:pointer;text-align:left;font:inherit;padding:7px 6px;border-radius:8px}
.dsh-qa-sidebar__item-main:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sidebar__item-delete{appearance:none;flex:none;display:flex;align-items:center;justify-content:center;border:0;background:0 0;cursor:pointer;color:var(--dsw-alias-label-tertiary);padding:5px;border-radius:6px;opacity:0;transition:opacity .12s}
.dsh-qa-sidebar__item:hover .dsh-qa-sidebar__item-delete,.dsh-qa-sidebar__item-delete:focus-visible,.dsh-qa-sidebar__item-delete--confirm{opacity:1}
.dsh-qa-sidebar__item-delete:hover{color:var(--dsw-alias-label-primary)}
.dsh-qa-sidebar__item-delete:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sidebar__item-delete--confirm{color:var(--dsh-qa-error-hover)}
.dsh-qa-sidebar__item-delete svg{width:14px;height:14px;display:block;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-sidebar__item-title{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-sidebar__item--active .dsh-qa-sidebar__item-title{color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-qa-sidebar__item-meta{flex:none;display:flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px}
.dsh-qa-sidebar__dot{width:7px;height:7px;border-radius:999px;background:var(--dsh-qa-brand);flex:none}
.dsh-qa-surface *{box-sizing:border-box}
.dsh-qa-surface ::selection{background:var(--dsh-qa-text-select)}
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
.dsh-qa-header__agents{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-qa-header__agents--end{margin-left:auto}
.dsh-qa-header__agents:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__agents:disabled{opacity:.45;cursor:default}
.dsh-qa-header__agents[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__agents svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-header__agents:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-agentview{display:flex;align-items:center;gap:8px;flex:none;padding:8px 28px;border-bottom:1px solid var(--dsh-qa-info-30);background:var(--dsh-qa-info-10);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
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
.dsh-qa-agents__open{flex:none;color:var(--dsh-qa-accent);font-size:12px;font-weight:500;line-height:18px}
.dsh-qa-header__sources{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-qa-header__sources--end{margin-left:auto}
.dsh-qa-header__sources:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__sources:disabled{opacity:.45;cursor:default}
.dsh-qa-header__sources[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-header__sources svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-header__sources:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:2px}
.dsh-qa-header__reset:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-header__reset:disabled{opacity:.45;cursor:default}
.dsh-qa-header__tabs{position:relative;z-index:1;display:flex;gap:32px;margin-top:4px}
.dsh-qa-header__tabs span{position:relative;padding:0 0 11px;color:var(--dsh-qa-accent);font-size:13px;font-weight:500;line-height:16px}
.dsh-qa-header__tabs span::after{content:"";position:absolute;right:0;bottom:1px;left:0;height:2px;border-radius:2px;background:var(--dsh-qa-accent)}
.dsh-qa-transcript{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.dsh-qa-transcript__inner{width:100%;min-height:100%;margin:0 auto;padding:18px 16px 42px}
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
.dsh-qa-sources{flex:none;display:flex;flex-direction:column;width:360px;min-height:0;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dsh-qa-sources__head{display:flex;align-items:center;justify-content:space-between;flex:none;padding:14px 12px 10px 16px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
.dsh-qa-sources__head button{appearance:none;display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-qa-sources__head button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-sources__head button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:-2px}
.dsh-qa-sources__head button svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round}
.dsh-qa-sources__list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 10px 12px}
.dsh-qa-sources__item{display:flex;gap:10px;margin:0 0 8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-sources__kind{display:grid;place-items:center;width:18px;height:18px;flex:none;margin-top:1px;color:var(--dsw-alias-label-tertiary)}
.dsh-qa-sources__kind svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-sources__text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsh-qa-sources__title{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:18px;text-decoration:none;text-overflow:ellipsis;white-space:nowrap}
a.dsh-qa-sources__title:hover{text-decoration:underline}
.dsh-qa-sources__target{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.dsh-qa-sources__text p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}
.dsh-qa-message{display:flex;flex-direction:column;width:100%;min-width:0;margin:0 0 20px}
.dsh-qa-message--user{align-items:flex-end;margin-left:auto}
.dsh-qa-message--assistant{align-items:flex-start;margin-right:auto}
.dsh-qa-message--work{align-items:flex-start;margin:-4px 0 14px}
.dsh-qa-message--system{align-items:center;margin:4px auto 20px}
.dsh-qa-message__content{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.62}
.dsh-qa-message--user .dsh-qa-message__content{max-width:min(525px,82%);padding:10px 16px;border-radius:22px;background:var(--dsw-specific-bubble);font-size:16px;line-height:24px}
.dsh-qa-message--assistant .dsh-qa-message__content{width:100%;padding:2px 0}
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

.dsh-qa-message__content p,.dsh-qa-message__content ul,.dsh-qa-message__content blockquote,.dsh-qa-message__content pre{margin:0 0 14px}
.dsh-qa-message__content :last-child{margin-bottom:0}
.dsh-qa-message__content h2,.dsh-qa-message__content h3,.dsh-qa-message__content h4{margin:18px 0 8px;line-height:1.35}
.dsh-qa-message__content h2{font-size:19px}.dsh-qa-message__content h3{font-size:17px}.dsh-qa-message__content h4{font-size:15px}
.dsh-qa-message__content ul{padding-left:22px}.dsh-qa-message__content a{color:var(--dsh-qa-accent)}
.dsh-qa-message__content code{border-radius:5px;padding:1px 4px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
.dsh-qa-message__content pre{overflow-x:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:13px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-message__content pre code{padding:0;background:transparent}
.dsh-qa-message__content ol{margin:0 0 14px;padding-left:22px}
.dsh-qa-message__content ol li,.dsh-qa-message__content ul li{margin:0 0 4px}
.dsh-qa-message__content hr{border:0;border-top:1px solid var(--dsw-alias-border-l2);margin:16px 0}
.dsh-qa-md-table{overflow-x:auto;margin:0 0 14px}
.dsh-qa-md-table table{border-collapse:collapse;width:auto;min-width:calc(100% - var(--dsh-qa-bleed,0px)*2);font-size:14px}
.dsh-qa-md-table th,.dsh-qa-md-table td{border:1px solid var(--dsw-alias-border-l2);padding:6px 10px;vertical-align:top}
.dsh-qa-md-table thead th{background:var(--dsw-alias-bg-layer-2);font-weight:600}
.dsh-qa-md-table tbody tr:nth-child(even){background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-message--assistant .dsh-qa-message__content pre,.dsh-qa-message--assistant .dsh-qa-md-table{--dsh-qa-bleed:min(72px,max(0px,(100vw - 100%)/2 - 28px));width:calc(100% + var(--dsh-qa-bleed)*2);margin-right:calc(var(--dsh-qa-bleed)*-1);margin-left:calc(var(--dsh-qa-bleed)*-1)}
.dsh-qa-message__content blockquote{border-left:3px solid var(--dsw-alias-border-l2);padding-left:12px;color:var(--dsw-alias-label-secondary)}
.dsh-qa-message__cursor{display:inline-block;width:7px;height:1em;margin-left:3px;vertical-align:-2px;background:var(--dsw-alias-label-secondary);animation:dsh-qa-blink 1s steps(2,start) infinite}
@keyframes dsh-qa-blink{50%{opacity:0}}
.dsh-qa-work{width:100%;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.dsh-qa-work__toggle{display:flex;align-items:center;gap:7px;min-height:30px;margin:0;padding:3px 5px 3px 0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dsh-qa-work__toggle:hover{color:var(--dsw-alias-label-primary)}
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
.dsh-qa-work-item__summary{min-width:0;overflow:hidden;flex:1;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap}.dsh-qa-work-item__agent-id{flex:none;padding:1px 6px;border-radius:999px;background:var(--dsh-qa-info-10);color:var(--dsh-qa-info);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;line-height:15px}.dsh-qa-work-tool[data-tool="subagent"],.dsh-qa-work-item[data-tool="subagent"]{border:1px solid var(--dsh-qa-info-30);border-radius:9px}
.dsh-qa-work-item--text{padding:5px 6px 9px}
.dsh-qa-work-item__text-head{display:flex;align-items:center;gap:7px;min-height:24px}
.dsh-qa-work-item__text{padding:3px 0 0 23px;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:23px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-work-item__text p,.dsh-qa-work-item__text ul,.dsh-qa-work-item__text pre{margin:0 0 9px}
.dsh-qa-work-item__text :last-child{margin-bottom:0}
.dsh-qa-work-tool__body{margin:0 6px 7px 29px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-work-tool__body section+section{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-qa-work-tool__body section>span{display:block;padding:7px 10px 0;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:18px;text-transform:uppercase;letter-spacing:.04em}
.dsh-qa-work-tool__body pre{max-height:260px;overflow:auto;margin:0;padding:7px 10px 10px;color:var(--dsw-alias-label-secondary);background:transparent;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:19px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-qa-error{display:flex;align-items:center;justify-content:center;gap:10px;margin:16px auto;padding:10px 12px;border:1px solid var(--dsh-qa-error);border-radius:10px;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-qa-error button{border:0;background:transparent;color:var(--dsh-qa-accent);font:inherit;font-weight:600;cursor:pointer}
.dsh-qa-footer{position:relative;flex:none;padding:28px 16px max(12px,env(safe-area-inset-bottom));background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-base) 0%,transparent) 0,var(--dsw-alias-bg-base) 28px)}
.dsh-qa-footer__inner{width:100%;margin:0 auto}
.dsh-qa-composer-wrap{display:flex;flex-direction:column;gap:10px;width:100%}
.dsh-qa-quick-questions{display:flex;gap:8px;width:100%;padding:2px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}
.dsh-qa-quick-questions button{flex:none;max-width:min(360px,80vw);padding:8px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.dsh-qa-quick-questions button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-qa-quick-questions button:disabled{opacity:.5;cursor:default}
.dsh-qa-quick-questions button:focus-visible{outline:2px solid var(--dsh-qa-accent);outline-offset:1px}
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
@media (max-width:600px){.dsh-qa-sidebar{display:none}.dsh-qa-sources,.dsh-qa-agents{position:absolute;inset:0;z-index:6;width:100%;border-left:0}.dsh-qa-header__inner{padding-left:16px;padding-right:16px}.dsh-qa-header h1{max-width:48vw}.dsh-qa-header__mode{font-size:12px}.dsh-qa-transcript__inner{padding:16px 16px 28px}.dsh-qa-message{margin-bottom:16px}.dsh-qa-message--user .dsh-qa-message__content{max-width:88%;font-size:15px}.dsh-qa-message__content{font-size:14px}.dsh-qa-footer{padding-left:10px;padding-right:10px;padding-bottom:max(8px,env(safe-area-inset-bottom))}.dsh-qa-composer{min-height:84px;padding-top:12px}.dsh-qa-composer__hint{font-size:0}.dsh-qa-composer__hint::after{content:"Enter: отправить";font-size:11px}}
@media (max-height:480px) and (orientation:landscape){.dsh-qa-header__inner{padding-top:6px}.dsh-qa-header__tabs{display:none}.dsh-qa-transcript__inner{padding-top:12px}.dsh-qa-footer{padding-top:12px}.dsh-qa-composer{min-height:72px;gap:4px;padding-top:8px}}
@media (prefers-reduced-motion:reduce){.dsh-qa-message__cursor,.dsh-qa-work__spinner,.dsh-qa-work-item__spinner{animation:none}.dsh-qa-work__chevron{transition:none}}
`;
