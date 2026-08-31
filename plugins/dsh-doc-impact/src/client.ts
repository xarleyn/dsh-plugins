import { createElement, useState } from "react";

// dsh-doc-impact browser client source. tsdown wraps this module in the
// classic factory served by the DSH web ModuleLoader at
// /plugins/@yadsh/dsh-doc-impact/client.js.
//
// Registers the plugin's card into the shared "Plugins → Plugin Configuration"
// section: the card claims the `doc-impact` settings namespace via the
// `settings.plugin.item` keyed slot and stages edits through the client
// settings scope, exactly like the first-party plugin cards.
//
// UX contract (mirrors @deepseek-ai/dsh-client-ui-settings-plugins):
//   - one collapsible card; the header shows an "unsaved" badge while drafts
//     exist;
//   - every field shows whether saving would leave a user-layer override and,
//     when one stands, a reset that stages a clear back to the composition
//     layer;
//   - Save stays disabled until there is something to write (and while a draft
//     is invalid or a save is in flight); Discard drops staged drafts;
//   - nothing writes before Save.
//
// Pure browser code: no DSH host imports; React stays external and is resolved
// by the ModuleLoader, while locale / settingsScope services are consumed
// optionally with built-in fallbacks so headless or older profiles stay safe.

    //#region settings model
    const SETTINGS_NS = "doc-impact";
    const LOCALE_NS = "dsh-doc-impact";

    const MODE_OPTIONS = ["remind", "require-review", "require-resolution", "require-update"];
    const ON_LIMIT_OPTIONS = ["allow", "warn", "error"];

    /** Field specs: kind text/number render as inputs, choice/bool as selects. */
    const FIELDS = [
      { field: "enabled", kind: "bool", fallback: true },
      { field: "configFile", kind: "text", fallback: ".dsh/doc-impact.yml" },
      { field: "mode", kind: "choice", options: MODE_OPTIONS, fallback: "remind" },
      { field: "maxReminderRounds", kind: "number", fallback: 2 },
      { field: "onLimit", kind: "choice", options: ON_LIMIT_OPTIONS, fallback: "allow" },
      { field: "maxSnapshotFiles", kind: "number", fallback: 10000 },
      { field: "debug", kind: "bool", fallback: false }
    ];

    function formatText(value: unknown): string {
      return typeof value === "string" ? value : "";
    }

    function formatNumber(value: unknown): string {
      return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    }

    function parseText(text: string): { kind: "clear" } | { kind: "set"; value: string } {
      const trimmed = text.trim();
      return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
    }

    function parseNumber(text: string): { kind: "clear" } | { kind: "set"; value: number } | undefined {
      const trimmed = text.trim();
      if (trimmed === "") return { kind: "clear" };
      if (!/^\d+$/u.test(trimmed)) return undefined;
      return { kind: "set", value: parseInt(trimmed, 10) };
    }

    function specOf(field: string): any {
      for (let i = 0; i < FIELDS.length; i++) {
        if (FIELDS[i]!.field === field) return FIELDS[i]!;
      }
      throw new Error("doc-impact card has no field " + field);
    }

    /**
     * Staged form over the `doc-impact` settings namespace — a port of the
     * first-party CardForm semantics: staged drafts never write; Save commits
     * field-granular set/unset calls in staging order; a save that did not
     * land keeps its drafts.
     */
    const SettingsForm: any = function SettingsForm(this: any, scope: any) {
      this.scope = scope;
      this.staged = new Map();
      this.listeners = new Set();
      this.saving = false;
      this.failed = false;
      this.snapshotCache = undefined;
      scope.subscribe(() => {
        this.publish();
      });
    };

    SettingsForm.prototype.getSnapshot = function () {
      if (this.snapshotCache === undefined) this.snapshotCache = this.projection();
      return this.snapshotCache;
    };

    SettingsForm.prototype.subscribe = function (listener: () => void) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    };

    SettingsForm.prototype.publish = function () {
      this.snapshotCache = undefined;
      this.listeners.forEach(function (listener: () => void) {
        listener();
      });
    };

    SettingsForm.prototype.snapshotOf = function () {
      return this.scope.getSnapshot();
    };

    SettingsForm.prototype.sectionValue = function (field: string) {
      const value = this.snapshotOf().value;
      return value !== undefined && value !== null && Object.hasOwn(value, field) ? value[field] : undefined;
    };

    SettingsForm.prototype.baseValue = function (field: string) {
      const base = this.snapshotOf().base;
      return base !== undefined && base !== null && Object.hasOwn(base, field) ? base[field] : undefined;
    };

    SettingsForm.prototype.userLayer = function () {
      return this.snapshotOf().user;
    };

    SettingsForm.prototype.stored = function (field: string) {
      const user = this.userLayer();
      return user !== undefined && user !== null && Object.hasOwn(user, field);
    };

    /** The value a staged clear would reveal: composition base over schema default. */
    SettingsForm.prototype.clearedValue = function (field: string) {
      const spec = specOf(field);
      const base = this.baseValue(field);
      return base === undefined ? spec.fallback : base;
    };

    SettingsForm.prototype.plan = function () {
      const plan: any[] = [];
      this.staged.forEach((staged: any, field: string) => {
        const spec = specOf(field);
        if (staged.op === "clear") {
          if (this.stored(field)) {
            plan.push({
              field: field,
              run: () => this.runClear(field)
            });
          }
          return;
        }
        if (spec.kind === "text" || spec.kind === "number") {
          if (staged.text === (spec.kind === "number" ? formatNumber(this.sectionValue(field)) : formatText(this.sectionValue(field)))) return;
          const write = spec.kind === "number" ? parseNumber(staged.text) : parseText(staged.text);
          if (write === undefined) {
            plan.push({ field: field, run: undefined });
          } else if (write.kind === "clear") {
            plan.push({
              field: field,
              run: () => this.runClear(field)
            });
          } else {
            const value = write.value;
            plan.push({
              field: field,
              run: () => this.runSet(field, value)
            });
          }
          return;
        }
        // choice / bool: value staging
        if (staged.value === this.sectionValue(field)) return;
        plan.push({
          field: field,
          run: () => this.runSet(field, staged.value)
        });
      });
      return plan;
    };

    SettingsForm.prototype.runClear = async function (field: string) {
      await this.scope.unset(field);
      return !this.stored(field);
    };

    SettingsForm.prototype.runSet = async function (field: string, value: unknown) {
      await this.scope.set(field, value);
      const user = this.userLayer();
      return user !== undefined && user !== null && user[field] === value;
    };

    SettingsForm.prototype.shell = function () {
      const snapshot = this.snapshotOf();
      const plan = this.plan();
      return {
        available: snapshot.status === "ready",
        writable: snapshot.writable,
        dirty: plan.length > 0,
        invalid: plan.some(function (item: any) {
          return item.run === undefined;
        }),
        saving: this.saving,
        failed: this.failed
      };
    };

    SettingsForm.prototype.field = function (field: string) {
      const spec = specOf(field);
      const staged = this.staged.get(field);
      if (staged !== undefined && staged.op === "clear") {
        const cleared = this.clearedValue(field);
        return {
          text: spec.kind === "number" ? formatNumber(cleared) : formatText(cleared),
          value: cleared,
          overridden: false,
          invalid: false
        };
      }
      if (staged !== undefined && staged.op === "set" && (spec.kind === "choice" || spec.kind === "bool")) {
        return { text: "", value: staged.value, overridden: true, invalid: false };
      }
      if (staged !== undefined && staged.op === "set") {
        const write = spec.kind === "number" ? parseNumber(staged.text) : parseText(staged.text);
        return {
          text: staged.text,
          value: undefined,
          overridden: write !== undefined && write.kind === "set",
          invalid: write === undefined
        };
      }
      const current = this.sectionValue(field);
      return {
        text: spec.kind === "number" ? formatNumber(current) : formatText(current),
        value: current === undefined ? spec.fallback : current,
        overridden: this.stored(field),
        invalid: false
      };
    };

    SettingsForm.prototype.stage = function (field: string, staged: any) {
      this.staged.set(field, staged);
      this.failed = false;
      this.publish();
    };

    SettingsForm.prototype.actions = function () {
      return {
        edit: (field: string, text: string) => {
          this.stage(field, { op: "set", text: text });
        },
        choose: (field: string, value: unknown) => {
          this.stage(field, { op: "set", value: value });
        },
        resetField: (field: string) => {
          const spec = specOf(field);
          if (spec.kind === "text" || spec.kind === "number") {
            const cleared = this.clearedValue(field);
            this.stage(field, {
              op: "set",
              text: spec.kind === "number" ? formatNumber(cleared) : formatText(cleared),
              clear: true
            });
          } else {
            this.stage(field, { op: "clear" });
          }
        },
        save: () => {
          return this.save();
        },
        discard: () => {
          if (this.staged.size === 0 && !this.failed) return;
          this.staged.clear();
          this.failed = false;
          this.publish();
        }
      };
    };

    SettingsForm.prototype.save = async function () {
      const plan = this.plan();
      const writes = plan.filter(function (item: any) {
        return item.run !== undefined;
      });
      if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
      this.saving = true;
      this.failed = false;
      this.publish();
      let landed = true;
      for (let i = 0; i < writes.length; i++) {
        try {
          const ok = await writes[i].run();
          landed = ok === true && landed;
        } catch (_error) {
          landed = false;
        }
      }
      if (landed) this.staged.clear();
      this.saving = false;
      this.failed = !landed;
      this.publish();
    };

    SettingsForm.prototype.projection = function () {
      const shell = this.shell();
      const fields: Record<string, any> = {};
      for (let i = 0; i < FIELDS.length; i++) {
        fields[FIELDS[i]!.field] = this.field(FIELDS[i]!.field);
      }
      return Object.assign({}, shell, { fields: fields });
    };

    SettingsForm.prototype.inject = function () {
      return {
        hooks: {
          docImpactCard: {
            getSnapshot: () => this.getSnapshot(),
            subscribe: (listener: () => void) => this.subscribe(listener)
          }
        },
        edit: this.actions().edit,
        choose: this.actions().choose,
        resetField: this.actions().resetField,
        save: this.actions().save,
        discard: this.actions().discard
      };
    };
    //#endregion

    //#region styles
    const CSS = [
      ".dsh-plugin-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
      ".dsh-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
      ".dsh-plugin-card--open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
      ".dsh-plugin-card__header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
      ".dsh-plugin-card__header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
      ".dsh-plugin-card__head-text{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
      ".dsh-plugin-card__name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
      ".dsh-plugin-card__description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
      ".dsh-plugin-card__badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
      ".dsh-plugin-card__chevron{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
      ".dsh-plugin-card--open .dsh-plugin-card__chevron{transform:rotate(180deg)}",
      ".dsh-plugin-card__body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}",
      ".ddi_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}",
      ".ddi_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
      ".ddi_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}",
      ".ddi_save,.ddi_discard{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
      ".ddi_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
      ".ddi_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
      ".ddi_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
      ".ddi_discard:disabled,.ddi_save:disabled{opacity:.4;cursor:default}",
      ".ddi_discard:focus-visible,.ddi_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
      ".ddi_field{margin:14px 0}",
      ".ddi_head{align-items:center;gap:8px;margin-bottom:6px;display:flex}",
      ".ddi_label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}",
      ".ddi_badges{align-items:center;gap:6px;margin-left:auto;display:flex}",
      ".ddi_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
      ".ddi_reset{appearance:none;cursor:pointer;font:inherit;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}",
      ".ddi_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
      ".ddi_reset:disabled{opacity:.4;cursor:default}",
      ".ddi_input,.ddi_select{appearance:none;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}",
      ".ddi_input:focus-visible,.ddi_select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}",
      ".ddi_input:disabled,.ddi_select:disabled{opacity:.5;cursor:default}",
      ".ddi_inputInvalid{border-color:var(--dsw-alias-label-error)}",
      ".ddi_hint{color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:12px;line-height:1.5}",
      ".ddi_invalid{color:var(--dsw-alias-label-error);margin:6px 0 0;font-size:12px;line-height:1.5}"
    ].join("\n");
    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="dsh-doc-impact/ConfigCard.module.css"]') === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-doc-impact";
      tag.dataset.pluginCss = "dsh-doc-impact/ConfigCard.module.css";
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region components
    function FieldHead(t: any, id: string, labelKey: string, state: any, disabled: boolean, onReset: () => void) {
      return createElement(
        "div",
        { className: "ddi_head" },
        createElement("label", { className: "ddi_label", htmlFor: id }, t(labelKey)),
        state.overridden
          ? createElement(
              "span",
              { className: "ddi_badges" },
              createElement("span", { className: "ddi_badge" }, t("overridden")),
              createElement(
                "button",
                { type: "button", className: "ddi_reset", disabled: disabled, onClick: onReset },
                t("reset")
              )
            )
          : null
      );
    }

    function TextField(props: any) {
      const state = props.state;
      return createElement(
        "div",
        { className: "ddi_field" },
        FieldHead(props.t, props.id, props.labelKey, state, props.disabled, props.onReset),
        createElement("input", {
          id: props.id,
          className: state.invalid ? "ddi_input ddi_inputInvalid" : "ddi_input",
          type: "text",
          value: state.text,
          disabled: props.disabled,
          onChange: function (event: any) {
            props.onEdit(event.target.value);
          }
        }),
        createElement(
          "p",
          { className: state.invalid ? "ddi_invalid" : "ddi_hint" },
          state.invalid ? props.t("invalidValue") : props.t(props.hintKey)
        )
      );
    }

    function NumberField(props: any) {
      const state = props.state;
      return createElement(
        "div",
        { className: "ddi_field" },
        FieldHead(props.t, props.id, props.labelKey, state, props.disabled, props.onReset),
        createElement("input", {
          id: props.id,
          className: state.invalid ? "ddi_input ddi_inputInvalid" : "ddi_input",
          type: "text",
          inputMode: "numeric",
          "aria-invalid": state.invalid ? "true" : undefined,
          value: state.text,
          disabled: props.disabled,
          onChange: function (event: any) {
            props.onEdit(event.target.value);
          }
        }),
        createElement(
          "p",
          { className: state.invalid ? "ddi_invalid" : "ddi_hint" },
          state.invalid ? props.t("invalidNumber") : props.t(props.hintKey)
        )
      );
    }

    function ChoiceField(props: any) {
      const state = props.state;
      const current = state.value === undefined ? props.fallback : state.value;
      return createElement(
        "div",
        { className: "ddi_field" },
        FieldHead(props.t, props.id, props.labelKey, state, props.disabled, props.onReset),
        createElement(
          "select",
          {
            id: props.id,
            className: "ddi_select",
            value: String(current),
            disabled: props.disabled,
            onChange: function (event: any) {
              props.onChoose(event.target.value);
            }
          },
          props.options.map(function (option: string) {
            return createElement("option", { key: option, value: option }, option);
          })
        ),
        createElement("p", { className: "ddi_hint" }, props.t(props.hintKey))
      );
    }

    function BoolField(props: any) {
      const state = props.state;
      const current = state.value === undefined ? props.fallback : state.value;
      return createElement(
        "div",
        { className: "ddi_field" },
        FieldHead(props.t, props.id, props.labelKey, state, props.disabled, props.onReset),
        createElement(
          "select",
          {
            id: props.id,
            className: "ddi_select",
            value: current === true ? "true" : "false",
            disabled: props.disabled,
            onChange: function (event: any) {
              props.onChoose(event.target.value === "true");
            }
          },
          createElement("option", { value: "true" }, props.t("on")),
          createElement("option", { value: "false" }, props.t("off"))
        ),
        createElement("p", { className: "ddi_hint" }, props.t(props.hintKey))
      );
    }

    function ChevronDown() {
      return createElement(
        "svg",
        {
          className: "dsh-plugin-card__chevron",
          viewBox: "0 0 14 14",
          fill: "none",
          "aria-hidden": "true"
        },
        createElement("path", {
          d: "m3.5 5.25 3.5 3.5 3.5-3.5",
          stroke: "currentColor",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        })
      );
    }

    function ConfigCard(props: any) {
      const openState = useState(false);
      const open = openState[0];
      const setOpen = openState[1];
      const state = props.useDocImpactCard(function (snapshot: any) {
        return snapshot;
      });
      if (!state.available) return null;
      const t = props.t;
      const blocked = !state.dirty || state.invalid || state.saving;
      const disabled = !state.writable || state.saving;
      const fields = state.fields;
      return createElement(
        "li",
        { className: open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card" },
        createElement(
          "button",
          {
            type: "button",
            className: "dsh-plugin-card__header",
            "aria-expanded": open,
            "aria-label": t(open ? "collapse" : "expand") + ": " + t("cardTitle"),
            onClick: function () {
              setOpen(!open);
            }
          },
          createElement(
            "span",
            { className: "dsh-plugin-card__head-text" },
            createElement("span", { className: "dsh-plugin-card__name" }, t("cardTitle")),
            createElement("span", { className: "dsh-plugin-card__description" }, t("cardDescription"))
          ),
          state.dirty ? createElement("span", { className: "dsh-plugin-card__badge" }, t("unsaved")) : null,
          createElement(ChevronDown)
        ),
        open
          ? createElement(
              "div",
              { className: "dsh-plugin-card__body" },
              !state.writable ? createElement("p", { className: "ddi_readOnly", role: "status" }, t("readOnly")) : null,
              createElement(BoolField, {
                t: t,
                id: "doc-impact-enabled",
                labelKey: "enabledLabel",
                hintKey: "enabledHint",
                fallback: true,
                state: fields.enabled,
                disabled: disabled,
                onChoose: function (value: unknown) {
                  props.choose("enabled", value);
                },
                onReset: function () {
                  props.resetField("enabled");
                }
              }),
              createElement(TextField, {
                t: t,
                id: "doc-impact-config-file",
                labelKey: "configFileLabel",
                hintKey: "configFileHint",
                state: fields.configFile,
                disabled: disabled,
                onEdit: function (text: string) {
                  props.edit("configFile", text);
                },
                onReset: function () {
                  props.resetField("configFile");
                }
              }),
              createElement(ChoiceField, {
                t: t,
                id: "doc-impact-mode",
                labelKey: "modeLabel",
                hintKey: "modeHint",
                options: MODE_OPTIONS,
                fallback: "remind",
                state: fields.mode,
                disabled: disabled,
                onChoose: function (value: unknown) {
                  props.choose("mode", value);
                },
                onReset: function () {
                  props.resetField("mode");
                }
              }),
              createElement(NumberField, {
                t: t,
                id: "doc-impact-max-reminder-rounds",
                labelKey: "maxReminderRoundsLabel",
                hintKey: "maxReminderRoundsHint",
                state: fields.maxReminderRounds,
                disabled: disabled,
                onEdit: function (text: string) {
                  props.edit("maxReminderRounds", text);
                },
                onReset: function () {
                  props.resetField("maxReminderRounds");
                }
              }),
              createElement(ChoiceField, {
                t: t,
                id: "doc-impact-on-limit",
                labelKey: "onLimitLabel",
                hintKey: "onLimitHint",
                options: ON_LIMIT_OPTIONS,
                fallback: "allow",
                state: fields.onLimit,
                disabled: disabled,
                onChoose: function (value: unknown) {
                  props.choose("onLimit", value);
                },
                onReset: function () {
                  props.resetField("onLimit");
                }
              }),
              createElement(NumberField, {
                t: t,
                id: "doc-impact-max-snapshot-files",
                labelKey: "maxSnapshotFilesLabel",
                hintKey: "maxSnapshotFilesHint",
                state: fields.maxSnapshotFiles,
                disabled: disabled,
                onEdit: function (text: string) {
                  props.edit("maxSnapshotFiles", text);
                },
                onReset: function () {
                  props.resetField("maxSnapshotFiles");
                }
              }),
              createElement(BoolField, {
                t: t,
                id: "doc-impact-debug",
                labelKey: "debugLabel",
                hintKey: "debugHint",
                fallback: false,
                state: fields.debug,
                disabled: disabled,
                onChoose: function (value: unknown) {
                  props.choose("debug", value);
                },
                onReset: function () {
                  props.resetField("debug");
                }
              }),
              createElement(
                "div",
                { className: "ddi_footer" },
                state.failed ? createElement("p", { className: "ddi_failed", role: "status" }, t("saveFailed")) : null,
                createElement(
                  "button",
                  {
                    type: "button",
                    className: "ddi_discard",
                    disabled: !state.dirty || state.saving,
                    onClick: props.discard
                  },
                  t("discard")
                ),
                createElement(
                  "button",
                  {
                    type: "button",
                    className: "ddi_save",
                    disabled: blocked,
                    onClick: props.save
                  },
                  t(state.saving ? "saving" : "save")
                )
              )
            )
          : null
      );
    }
    //#endregion

    //#region locale
    const DICT: Record<string, Record<string, string>> = {
      zh: {
        cardTitle: "Doc Impact 文档联动",
        cardDescription: "文档影响检查插件的运行设置",
        unsaved: "未保存",
        readOnly: "当前连接为只读，无法修改设置。",
        save: "保存",
        saving: "保存中…",
        discard: "放弃更改",
        saveFailed: "保存未生效，草稿已保留，请重试。",
        expand: "展开",
        collapse: "收起",
        overridden: "已覆盖",
        reset: "重置",
        invalidNumber: "请输入正整数",
        invalidValue: "输入无效",
        on: "开",
        off: "关",
        enabledLabel: "启用插件",
        enabledHint: "关闭后插件完全静默，不检查任何影响。",
        configFileLabel: "工作区配置路径",
        configFileHint: "相对会话工作目录，默认 .dsh/doc-impact.yml。",
        modeLabel: "默认模式",
        modeHint: "工作区规则未显式声明 mode 时的默认值。",
        maxReminderRoundsLabel: "最大提醒轮数",
        maxReminderRoundsHint: "严格模式下同一 impact 的最大提醒次数。",
        onLimitLabel: "超限行为",
        onLimitHint: "allow 静默放行；warn 记录警告；error 发送最终提示。",
        maxSnapshotFilesLabel: "快照文件上限",
        maxSnapshotFilesHint: "基线快照的最大文件数，超出后降级运行。",
        debugLabel: "调试日志",
        debugHint: "输出基线、变更与提醒的调试信息。"
      },
      en: {
        cardTitle: "Doc Impact",
        cardDescription: "Settings of the documentation impact plugin",
        unsaved: "Unsaved",
        readOnly: "This connection is read-only; settings cannot be changed.",
        save: "Save",
        saving: "Saving…",
        discard: "Discard",
        saveFailed: "The save did not land; drafts kept — please retry.",
        expand: "Expand",
        collapse: "Collapse",
        overridden: "Overridden",
        reset: "Reset",
        invalidNumber: "Enter a positive integer",
        invalidValue: "Invalid input",
        on: "On",
        off: "Off",
        enabledLabel: "Enabled",
        enabledHint: "When off the plugin stays fully silent and checks nothing.",
        configFileLabel: "Workspace config path",
        configFileHint: "Relative to the session working directory; .dsh/doc-impact.yml by default.",
        modeLabel: "Default mode",
        modeHint: "Used by workspace rules that do not declare an explicit mode.",
        maxReminderRoundsLabel: "Max reminder rounds",
        maxReminderRoundsHint: "Steer limit for the same impact in strict modes.",
        onLimitLabel: "On limit",
        onLimitHint: "allow finishes silently; warn logs; error sends a final notice.",
        maxSnapshotFilesLabel: "Max snapshot files",
        maxSnapshotFilesHint: "Baseline snapshot cap; detection degrades gracefully beyond it.",
        debugLabel: "Debug logging",
        debugHint: "Log baselines, change detection, and reminders."
      }
    };

    function fallbackT(key: string): string {
      const zh = DICT.zh![key];
      return zh === undefined ? key : zh;
    }
    //#endregion

    //#region plugin
    export const name = "doc-impact";
    export const inject = ["slots"];

    export function apply(ctx: any): void {
      let _t = fallbackT;
      const locale = ctx.get("locale");
      if (locale && typeof locale.register === "function" && typeof locale.bind === "function") {
        locale.register(LOCALE_NS, DICT);
        _t = locale.bind(LOCALE_NS);
      }

      const settingsScope = ctx.get("settingsScope");
      if (!settingsScope || typeof settingsScope.bind !== "function") return;
      const scope = settingsScope.bind({ namespace: SETTINGS_NS });
      const form = new SettingsForm(scope);

      ctx.slots.inject("settings.plugin.item", function* () {
        yield ctx.slots.register(
          {
            name: "settings.plugin.item",
            key: SETTINGS_NS,
            locale: LOCALE_NS,
            inject: function () {
              return form.inject();
            }
          },
          ConfigCard
        );
      });
    }
