import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import { useState, type ChangeEvent, type ReactNode } from "react";
import {
  SleevSettingsController,
  type SleevSettingsCardFace,
  type SleevSettingsField,
  type SleevSettingsFieldState,
} from "./settings-controller.js";
import { SLEEV_SETTINGS_NAMESPACE_ID } from "../shared/settings.js";

export * from "./settings-controller.js";

const LOCALE_NAMESPACE = "dsh-sleev";
const SETTINGS_NAMESPACE = SLEEV_SETTINGS_NAMESPACE_ID;

type SleevLocaleKey =
  | "title"
  | "description"
  | "expand"
  | "collapse"
  | "unsaved"
  | "overridden"
  | "reset"
  | "routes"
  | "routesHint"
  | "routePrefixes"
  | "routePrefixesHint"
  | "maxRecentCalls"
  | "maxRecentCallsHint"
  | "logLevel"
  | "logLevelHint"
  | "logOff"
  | "logInfo"
  | "logDebug"
  | "invalidNumber"
  | "readOnly"
  | "saveFailed"
  | "discard"
  | "save"
  | "saving";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dsh-sleev": SleevLocaleKey;
  }
}

const en: Record<SleevLocaleKey, string> = {
  title: "Sleev",
  description: "Observed routes and telemetry retention.",
  expand: "Show settings",
  collapse: "Hide settings",
  unsaved: "Unsaved",
  overridden: "Overridden",
  reset: "Reset to default",
  routes: "Exact routes",
  routesHint: "One DSH provider alias per line. Empty means no exact matches.",
  routePrefixes: "Route prefixes",
  routePrefixesHint: "One prefix per line. The default is sleev-.",
  maxRecentCalls: "Recent calls retained",
  maxRecentCallsHint: "Maximum secret-free telemetry records kept in memory.",
  logLevel: "Telemetry logging",
  logLevelHint: "Controls structured call start/end logging.",
  logOff: "Off",
  logInfo: "Completed calls",
  logDebug: "Call starts and completions",
  invalidNumber: "Enter a positive whole number.",
  readOnly: "This deployment stores settings read-only.",
  saveFailed: "The deployment did not accept these values.",
  discard: "Discard",
  save: "Save",
  saving: "Saving…",
};

const zh: Record<SleevLocaleKey, string> = {
  title: "Sleev",
  description: "观测路由和遥测保留设置。",
  expand: "展开设置",
  collapse: "收起设置",
  unsaved: "未保存",
  overridden: "已覆盖",
  reset: "恢复默认值",
  routes: "精确路由",
  routesHint: "每行一个 DSH 提供商别名。留空表示不进行精确匹配。",
  routePrefixes: "路由前缀",
  routePrefixesHint: "每行一个前缀。默认值为 sleev-。",
  maxRecentCalls: "保留最近调用数",
  maxRecentCallsHint: "内存中最多保留多少条无敏感信息的遥测记录。",
  logLevel: "遥测日志",
  logLevelHint: "控制结构化调用开始和结束日志。",
  logOff: "关闭",
  logInfo: "仅完成的调用",
  logDebug: "调用开始和完成",
  invalidNumber: "请输入正整数。",
  readOnly: "此部署的设置为只读。",
  saveFailed: "部署未接受这些值。",
  discard: "放弃修改",
  save: "保存",
  saving: "保存中…",
};

const CARD_STYLES = `
.dsh-sleev-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s ease,background .16s ease}
.dsh-sleev-card:hover{border-color:var(--dsw-alias-border-label-dimmed)}
.dsh-sleev-card.dsh-sleev-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-label-dimmed)}
.dsh-sleev-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-sleev-header:focus-visible,.dsh-sleev-button:focus-visible,.dsh-sleev-reset:focus-visible,.dsh-sleev-input:focus-visible{outline:2px solid var(--dsw-alias-border-brand);outline-offset:2px}
.dsh-sleev-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-sleev-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-sleev-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-sleev-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s ease;font-size:16px;line-height:1}
.dsh-sleev-card-open .dsh-sleev-chevron{transform:rotate(180deg)}
.dsh-sleev-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dsh-sleev-read-only{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-sleev-pill{border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-sleev-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.dsh-sleev-field+.dsh-sleev-field{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-sleev-field-head{display:flex;align-items:center;gap:8px}
.dsh-sleev-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-sleev-badges{display:inline-flex;align-items:center;gap:8px}
.dsh-sleev-reset{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-sleev-reset:disabled{opacity:.4;cursor:default}
.dsh-sleev-input{box-sizing:border-box;width:100%;min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
textarea.dsh-sleev-input{height:64px;min-height:48px;padding:8px 12px;resize:vertical}
.dsh-sleev-input:focus{border-color:var(--dsw-alias-border-brand);outline:none}
.dsh-sleev-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsh-sleev-input[aria-invalid=true]{border-color:var(--dsw-alias-border-error)}
.dsh-sleev-hint,.dsh-sleev-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-sleev-error{color:var(--dsw-alias-label-error)}
.dsh-sleev-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-sleev-save-error{flex:1;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
.dsh-sleev-button{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.dsh-sleev-discard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}
.dsh-sleev-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-sleev-button:disabled{opacity:.4;cursor:default}
`;

type SleevSettingsCardProps = PropsRuntime<"settings.plugin.item"> &
  PropsLocale<"dsh-sleev"> &
  InjectFace<SleevSettingsCardFace>;

function SettingsField(props: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly state: SleevSettingsFieldState;
  readonly writable: boolean;
  readonly overriddenLabel: string;
  readonly resetLabel: string;
  readonly invalidLabel?: string;
  readonly onReset: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="dsh-sleev-field">
      <div className="dsh-sleev-field-head">
        <label htmlFor={props.id} className="dsh-sleev-label">
          {props.label}
        </label>
        {props.state.overridden ? (
          <span className="dsh-sleev-badges">
            <span className="dsh-sleev-pill">{props.overriddenLabel}</span>
            <button
              type="button"
              className="dsh-sleev-reset"
              disabled={!props.writable}
              onClick={props.onReset}
            >
              {props.resetLabel}
            </button>
          </span>
        ) : null}
      </div>
      {props.children}
      {props.state.invalid ? (
        <p className="dsh-sleev-error">{props.invalidLabel}</p>
      ) : null}
      <p className="dsh-sleev-hint">{props.hint}</p>
    </div>
  );
}

/** Settings card contributed to the official Plugins → Plugin configuration tab. */
export function SleevSettingsCard(props: SleevSettingsCardProps) {
  const [open, setOpen] = useState(false);
  const state = props.useSleevSettings((snapshot) => snapshot);
  if (!state.available) return null;
  const blocked =
    !state.dirty || state.invalid || state.saving || !state.writable;
  const edit =
    (field: SleevSettingsField) =>
    (
      event: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      props.edit(field, event.target.value);
  const common = (field: SleevSettingsField) => ({
    state: state[field],
    writable: state.writable,
    overriddenLabel: props.t("overridden"),
    resetLabel: props.t("reset"),
    onReset: () => props.resetField(field),
  });

  return (
    <li className={`dsh-sleev-card${open ? " dsh-sleev-card-open" : ""}`}>
      <button
        type="button"
        className="dsh-sleev-header"
        aria-expanded={open}
        aria-label={`${props.t(open ? "collapse" : "expand")}: Sleev`}
        onClick={() => setOpen(!open)}
      >
        <span className="dsh-sleev-head-text">
          <span className="dsh-sleev-name">{props.t("title")}</span>
          <span className="dsh-sleev-description">
            {props.t("description")}
          </span>
        </span>
        {state.dirty ? (
          <span className="dsh-sleev-pill">{props.t("unsaved")}</span>
        ) : null}
        <span className="dsh-sleev-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open ? (
        <div className="dsh-sleev-body">
          {!state.writable ? (
            <p className="dsh-sleev-read-only" role="status">
              {props.t("readOnly")}
            </p>
          ) : null}

          <SettingsField
            id="sleev-routes"
            label={props.t("routes")}
            hint={props.t("routesHint")}
            {...common("routes")}
          >
            <textarea
              id="sleev-routes"
              className="dsh-sleev-input"
              value={state.routes.text}
              disabled={!state.writable}
              onChange={edit("routes")}
            />
          </SettingsField>

          <SettingsField
            id="sleev-route-prefixes"
            label={props.t("routePrefixes")}
            hint={props.t("routePrefixesHint")}
            {...common("routePrefixes")}
          >
            <textarea
              id="sleev-route-prefixes"
              className="dsh-sleev-input"
              value={state.routePrefixes.text}
              disabled={!state.writable}
              onChange={edit("routePrefixes")}
            />
          </SettingsField>

          <SettingsField
            id="sleev-max-recent-calls"
            label={props.t("maxRecentCalls")}
            hint={props.t("maxRecentCallsHint")}
            invalidLabel={props.t("invalidNumber")}
            {...common("maxRecentCalls")}
          >
            <input
              id="sleev-max-recent-calls"
              className="dsh-sleev-input"
              type="number"
              min={1}
              step={1}
              value={state.maxRecentCalls.text}
              disabled={!state.writable}
              aria-invalid={state.maxRecentCalls.invalid}
              onChange={edit("maxRecentCalls")}
            />
          </SettingsField>

          <SettingsField
            id="sleev-log-level"
            label={props.t("logLevel")}
            hint={props.t("logLevelHint")}
            {...common("logLevel")}
          >
            <select
              id="sleev-log-level"
              className="dsh-sleev-input"
              value={state.logLevel.text}
              disabled={!state.writable}
              onChange={edit("logLevel")}
            >
              <option value="off">{props.t("logOff")}</option>
              <option value="info">{props.t("logInfo")}</option>
              <option value="debug">{props.t("logDebug")}</option>
            </select>
          </SettingsField>

          <div className="dsh-sleev-footer">
            {state.failed ? (
              <p className="dsh-sleev-save-error" role="status">
                {props.t("saveFailed")}
              </p>
            ) : null}
            <button
              type="button"
              className="dsh-sleev-button dsh-sleev-discard"
              disabled={!state.dirty || state.saving}
              onClick={props.discard}
            >
              {props.t("discard")}
            </button>
            <button
              type="button"
              className="dsh-sleev-button dsh-sleev-save"
              disabled={blocked}
              onClick={props.save}
            >
              {props.t(state.saving ? "saving" : "save")}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export const inject = ["slots", "settingsScope", "locale"];

/** Register Sleev's localized settings card in the official keyed plugin slot. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.dshSleev = "settings";
    style.textContent = CARD_STYLES;
    document.head.append(style);
    return () => style.remove();
  }, "dsh-sleev: settings styles");
  ctx.effect(
    () => ctx.locale.register(LOCALE_NAMESPACE, { en, zh }),
    "dsh-sleev: settings dictionaries",
  );
  const controller = new SleevSettingsController(
    ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }),
  );
  ctx.slots.inject("settings.plugin.item", () => {
    const unregister = ctx.slots.register(
      {
        name: "settings.plugin.item",
        key: SETTINGS_NAMESPACE,
        locale: LOCALE_NAMESPACE,
        inject: () => controller.inject(),
      },
      SleevSettingsCard,
    );
    return () => {
      controller.dispose();
      unregister();
    };
  });
}
