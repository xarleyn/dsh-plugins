// The doc-impact settings card: canonical shell (from the client kit) plus the
// plugin field components, and the one-time stylesheet injection.
import {
  CardShell,
  PLUGIN_CARD_SHELL_CSS,
  injectCardStyles,
} from "@yadsh/dsh-plugin-kit/client";
import { createElement } from "react";
import { MODE_OPTIONS, ON_LIMIT_OPTIONS } from "./settings-form.js";
import { BoolField, ChoiceField, NumberField, TextField } from "./fields.js";

const CSS = [
  PLUGIN_CARD_SHELL_CSS.trim(),
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
if (typeof document !== "undefined") injectCardStyles("dsh-doc-impact", CSS);


export function ConfigCard(props: any) {
  const state = props.useDocImpactCard(function (snapshot: any) {
    return snapshot;
  });
  if (!state.available) return null;
  const t = props.t;
  const blocked = !state.dirty || state.invalid || state.saving;
  const disabled = !state.writable || state.saving;
  const fields = state.fields;
  return createElement(
    CardShell,
    {
      title: t("cardTitle"),
      description: t("cardDescription"),
      label: function (open: boolean) {
        return t(open ? "collapse" : "expand") + ": " + t("cardTitle");
      },
      badge: state.dirty
        ? createElement("span", { className: "dsh-plugin-card__badge" }, t("unsaved"))
        : undefined
    },
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
  );

}
