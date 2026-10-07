import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ChangeEvent, ReactNode } from "react";
import {
  SleevSettingsController,
  type SleevSettings,
  type SleevSettingsCardFace,
  type SleevSettingsField,
  type SleevSettingsFieldState,
} from "./settings-controller.js";
import {
  SLEEV_ROW_CONFIG_KEY,
  SLEEV_SETTINGS_NAMESPACE_ID,
} from "../shared/settings.js";

export * from "./settings-controller.js";

const LOCALE_NAMESPACE = "dsh-sleev";
const SETTINGS_NAMESPACE = SLEEV_SETTINGS_NAMESPACE_ID;

type SleevLocaleKey =
  | "description"
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
  | "loading"
  | "noSettings"
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

/**
 * The English dictionary this card's copy is read from.
 *
 * Exported because its `description` is one string with `meta.description` of
 * `locale/en.json`: the page fills the row's line from that file and asks this seat
 * for the sentence only when the row carries none, and a test pins the pair so one
 * row cannot describe two pages.
 */
export const SLEEV_EN_DICTIONARY: Record<SleevLocaleKey, string> = {
  description: "Observed routes and telemetry retention.",
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
  loading: "Loading Sleev's settings…",
  noSettings:
    "Sleev's settings are not open to this session, so nothing here can be read or changed yet. The observer keeps reporting with the last configuration the Host accepted.",
  readOnly: "This deployment stores settings read-only.",
  saveFailed: "The deployment did not accept these values.",
  discard: "Discard",
  save: "Save",
  saving: "Saving…",
};

const zh: Record<SleevLocaleKey, string> = {
  description: "观测路由和遥测保留设置。",
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
  loading: "正在加载 Sleev 的设置…",
  noSettings:
    "当前会话没有打开 Sleev 的设置，因此这里暂时既不能查看也不能修改。观测器仍会按宿主接受的最后一份配置继续上报。",
  readOnly: "此部署的设置为只读。",
  saveFailed: "部署未接受这些值。",
  discard: "放弃修改",
  save: "保存",
  saving: "保存中…",
};

/*
 * Body rules only. The Plugins panel page draws this card's frame, its heading
 * and its expand control, so the bundle ships no shell of its own (AGENTS.md);
 * the ring on every control the package renders is the Host's token pair, each
 * half with a fallback, because a hard-coded outline loses to `focus.css` and an
 * undeclared token would drop the whole `outline` shorthand.
 */
const CARD_STYLES = `.dsh-sleev-config{display:flex;flex-direction:column;gap:12px}
.dsh-sleev-no-settings,.dsh-sleev-loading{margin:0;padding:12px 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-sleev-button:focus-visible,.dsh-sleev-reset:focus-visible,.dsh-sleev-input:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-sleev-read-only{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
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
.dsh-sleev-input:focus{border-color:var(--dsw-alias-border-brand)}
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

type SleevSettingsCardProps = PropsRuntime<"plugins.row.config"> &
  PropsLocale<"dsh-sleev"> &
  InjectFace<SleevSettingsCardFace>;

function SettingsField(props: {
  readonly id: string;
  readonly testId: string;
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
    <div className="dsh-sleev-field" data-testid={props.testId}>
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
              data-testid="sleev-field-reset"
              onClick={props.onReset}
            >
              {props.resetLabel}
            </button>
          </span>
        ) : null}
      </div>
      {props.children}
      {props.state.invalid ? (
        <p className="dsh-sleev-error" data-testid="sleev-field-error">
          {props.invalidLabel}
        </p>
      ) : null}
      <p className="dsh-sleev-hint">{props.hint}</p>
    </div>
  );
}

/** Body of the Sleev bundle row's configuration page on the Host Plugins panel. */
export function SleevSettingsCard(props: SleevSettingsCardProps) {
  // The seat hands its registrant a `form` owner prop of its own — the page's
  // `ConfigPageForm`, only `{ state, mutate }`, which can be neither subscribed
  // to nor written field by field. The card never reads it: the live `ConfigForm`
  // for the namespace arrives through this injected face instead.
  const state = props.useSleevSettings((snapshot) => snapshot);
  /*
   * The namespace answers three states, and the row's frame takes one line each:
   * a single sentence for all of them made a page that is still loading claim it
   * has nothing to edit. `unavailable` is the settings directory closed to this
   * client — a non-loopback browser, or memory mode — where the card still has to
   * answer, and `loading` is the first snapshot of a namespace that will serve.
   * The old tab could stay shut through both; here the row's Configure control is
   * drawn from the inventory, so silence would open a row on an empty section.
   * Neither line is a live region: `loading` is replaced by the form as soon as
   * the namespace serves, and a `role="status"` would read that swap out.
   */
  if (state.status === "unavailable") {
    return (
      <div className="dsh-sleev-config" data-testid="sleev-row-config">
        <p className="dsh-sleev-no-settings" data-testid="sleev-no-settings">
          {props.t("noSettings")}
        </p>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="dsh-sleev-config" data-testid="sleev-row-config">
        <p className="dsh-sleev-loading" data-testid="sleev-loading">
          {props.t("loading")}
        </p>
      </div>
    );
  }
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
    // The page draws the frame, the heading and the expand control around what
    // this returns, so the body is mounted straight away and carries no shell,
    // no badge of the header's, and no chevron of ours (AGENTS.md). The unsaved
    // marker the old header held moves into the footer beside the write controls.
    <div className="dsh-sleev-config" data-testid="sleev-row-config">
      {!state.writable ? (
        <p
          className="dsh-sleev-read-only"
          role="status"
          data-testid="sleev-read-only"
        >
          {props.t("readOnly")}
        </p>
      ) : null}

      <SettingsField
        id="sleev-routes"
        testId="sleev-routes-field"
        label={props.t("routes")}
        hint={props.t("routesHint")}
        {...common("routes")}
      >
        <textarea
          id="sleev-routes"
          className="dsh-sleev-input"
          value={state.routes.text}
          disabled={!state.writable}
          data-testid="sleev-routes"
          onChange={edit("routes")}
        />
      </SettingsField>

      <SettingsField
        id="sleev-route-prefixes"
        testId="sleev-route-prefixes-field"
        label={props.t("routePrefixes")}
        hint={props.t("routePrefixesHint")}
        {...common("routePrefixes")}
      >
        <textarea
          id="sleev-route-prefixes"
          className="dsh-sleev-input"
          value={state.routePrefixes.text}
          disabled={!state.writable}
          data-testid="sleev-route-prefixes"
          onChange={edit("routePrefixes")}
        />
      </SettingsField>

      <SettingsField
        id="sleev-max-recent-calls"
        testId="sleev-max-recent-calls-field"
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
          data-testid="sleev-max-recent-calls"
          onChange={edit("maxRecentCalls")}
        />
      </SettingsField>

      <SettingsField
        id="sleev-log-level"
        testId="sleev-log-level-field"
        label={props.t("logLevel")}
        hint={props.t("logLevelHint")}
        {...common("logLevel")}
      >
        <select
          id="sleev-log-level"
          className="dsh-sleev-input"
          value={state.logLevel.text}
          disabled={!state.writable}
          data-testid="sleev-log-level"
          onChange={edit("logLevel")}
        >
          <option value="off">{props.t("logOff")}</option>
          <option value="info">{props.t("logInfo")}</option>
          <option value="debug">{props.t("logDebug")}</option>
        </select>
      </SettingsField>

      <div className="dsh-sleev-footer">
        {state.failed ? (
          <p
            className="dsh-sleev-save-error"
            role="status"
            data-testid="sleev-save-error"
          >
            {props.t("saveFailed")}
          </p>
        ) : null}
        {state.dirty ? (
          <span className="dsh-sleev-pill" data-testid="sleev-unsaved">
            {props.t("unsaved")}
          </span>
        ) : null}
        <button
          type="button"
          className="dsh-sleev-button dsh-sleev-discard"
          disabled={!state.dirty || state.saving}
          data-testid="sleev-discard"
          onClick={props.discard}
        >
          {props.t("discard")}
        </button>
        <button
          type="button"
          className="dsh-sleev-button dsh-sleev-save"
          disabled={blocked}
          data-testid="sleev-save"
          onClick={props.save}
        >
          {props.t(state.saving ? "saving" : "save")}
        </button>
      </div>
    </div>
  );
}

export const inject = ["slots", "configForms", "locale"];

/**
 * Configuration seat of the Sleev bundle row on the Host Plugins page. The
 * contract of the declared peer dependency —
 * `@deepseek-ai/dsh-client-ui-plugin-manager`, `lib/types/client/slot-contract`
 * — names the slot and hands it `PluginConfigViewProps`, whose `view` is the
 * union `'summary' | 'page'` and whose `form` is only the page's `ConfigPageForm`
 * (`{ state, mutate }`). Because this bundle's `cordis.patch.yml` gives the row
 * no description, the contract's fallback — an absent description falls back to
 * the entry's `view: 'summary'` — is the path this row actually takes: `summary`
 * answers with the one-liner that lands in the page's own description paragraph,
 * so a card there would draw a page within a line, and `page` is the form body.
 * The body carries no frame of its own: the row-detail page draws the surface,
 * the row title and the expand control before it is mounted, and a shell here
 * would be a second card inside the Host's. The card resolves the full
 * `ConfigForm` for the `dsh-sleev` namespace through its injected face rather
 * than through the seat's shallow `form`, which is what keeps values stored before
 * the move readable after it.
 */
export function SleevRowConfig(props: SleevSettingsCardProps): ReactNode {
  if (props.view === "summary") return props.t("description");
  return <SleevSettingsCard {...props} />;
}

/** Register Sleev's localized settings card as its bundle row's configuration page. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.dshSleev = "settings";
    style.textContent = CARD_STYLES;
    document.head.append(style);
    return () => style.remove();
  }, "dsh-sleev: settings styles");
  ctx.effect(
    () =>
      ctx.locale.register(LOCALE_NAMESPACE, {
        en: SLEEV_EN_DICTIONARY,
        zh,
      }),
    "dsh-sleev: settings dictionaries",
  );
  const controller = new SleevSettingsController(
    ctx.configForms.get<SleevSettings>(SETTINGS_NAMESPACE),
  );
  ctx.slots.inject("plugins.row.config", () => {
    const unregister = ctx.slots.register(
      {
        name: "plugins.row.config",
        key: SLEEV_ROW_CONFIG_KEY,
        locale: LOCALE_NAMESPACE,
        inject: () => controller.inject(),
      },
      SleevRowConfig,
    );
    return () => {
      controller.dispose();
      unregister();
    };
  });
}
