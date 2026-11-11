export const composerSettingsStyles = String.raw`
.dsh-qa-composer-settings{display:inline-flex;min-width:0;max-width:100%}
.dsh-qa-composer-settings__trigger{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:100%;min-height:32px;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:16px;cursor:pointer}
.dsh-qa-composer-settings__summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-composer-settings__trigger:hover,.dsh-qa-composer-settings__trigger[aria-expanded="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.dsh-qa-composer-settings__trigger:active{transform:translateY(1px)}
.dsh-qa-composer-settings__trigger svg{flex:none;width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-composer-settings__popup{position:fixed;z-index:2147483005;box-sizing:border-box;width:288px;max-width:calc(100vw - 16px);max-height:min(360px,calc(100dvh - 32px));padding:4px;overflow-y:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv2);font-size:14px;line-height:20px}
.dsh-qa-composer-settings__popup button{appearance:none;display:flex;align-items:center;gap:12px;width:100%;padding:8px 12px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsh-qa-composer-settings__popup button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-composer-settings__popup button:active:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-qa-composer-settings__popup button:disabled{opacity:.5;cursor:default}
.dsh-qa-composer-settings__popup button:focus-visible,.dsh-qa-composer-settings__trigger:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dsh-qa-composer-settings__popup svg{flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-composer-settings__row-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
.dsh-qa-composer-settings__row-copy>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-composer-settings__row-copy small{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.dsh-qa-composer-settings__popup .dsh-qa-composer-settings__back{margin-bottom:4px;color:var(--dsw-alias-label-secondary);font-weight:500}
.dsh-qa-composer-settings__error{margin:8px 12px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px;overflow-wrap:anywhere}
`;
