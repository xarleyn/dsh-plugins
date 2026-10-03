// The doc-impact settings card: the body the Plugins row page mounts, the plugin
// field components, and the one-time stylesheet injection.
//
// The frame around this view is not ours (AGENTS.md, "Two kinds of card"): the row
// page draws the card surface, the row title and the expand control before it mounts
// what the `page` view returns, so this file renders no outer shell, no heading and
// no toggle of its own. That also decides the focus treatment — the Host's
// `focus.css` suppresses a hard-coded outline under pointer modality at a higher
// specificity than a rule of ours can reach without fighting it, so every control
// drawn here takes the Host's ring tokens instead, each with a fallback: an undeclared
// token would invalidate the whole `outline` shorthand and drop the ring entirely.
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import { injectCardStyles } from "@yadsh/dsh-plugin-kit/client";
import { createElement } from "react";
import {
  MODE_OPTIONS,
  ON_LIMIT_OPTIONS,
  type CardFace,
  type ModeOption,
  type OnLimitOption,
} from "./settings-form.js";
import {
  BoolField,
  ChoiceField,
  NumberField,
  TextAreaField,
  TextField,
  type ChoiceProps,
} from "./fields.js";

const CSS = [
  ".ddi_body{color:var(--dsw-alias-label-primary)}",
  ".ddi_notice{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}",
  ".ddi_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
  ".ddi_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}",
  ".ddi_save,.ddi_discard{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
  ".ddi_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
  ".ddi_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
  ".ddi_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
  ".ddi_discard:disabled,.ddi_save:disabled{opacity:.4;cursor:default}",
  ".ddi_save:focus-visible,.ddi_discard:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:1px}",
  ".ddi_field{margin:14px 0}",
  ".ddi_head{align-items:center;gap:8px;margin-bottom:6px;display:flex}",
  ".ddi_label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}",
  ".ddi_badges{align-items:center;gap:6px;margin-left:auto;display:flex}",
  ".ddi_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
  ".ddi_reset{appearance:none;cursor:pointer;font:inherit;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}",
  ".ddi_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
  ".ddi_reset:disabled{opacity:.4;cursor:default}",
  ".ddi_reset:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}",
  ".ddi_input,.ddi_select{appearance:none;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}",
  ".ddi_textarea{resize:vertical;min-height:132px;font-family:inherit}",
  ".ddi_input:focus-visible,.ddi_select:focus-visible,.ddi_textarea:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:-1px}",
  ".ddi_input:disabled,.ddi_select:disabled,.ddi_textarea:disabled{opacity:.5;cursor:default}",
  ".ddi_inputInvalid{border-color:var(--dsw-alias-label-error)}",
  ".ddi_hint{color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:12px;line-height:1.5}",
  ".ddi_invalid{color:var(--dsw-alias-label-error);margin:6px 0 0;font-size:12px;line-height:1.5}",
].join("\n");
if (typeof document !== "undefined") injectCardStyles("dsh-doc-impact", CSS);

/**
 * The half of the seat's props the configuration body reads, composed from the
 * Host's own declarations rather than re-typed here:
 *
 * - `InjectFace<CardFace>` — our injected face with its `hooks` compartment bound,
 *   so `hooks.docImpactCard` arrives as the `useDocImpactCard` selector hook;
 * - `PropsLocale<"dsh-doc-impact">` — the `t` seat, present exactly because the
 *   registration declares that `locale:` namespace. The Host's renderer either
 *   synthesizes it or fails the slot assembly with a `SlotAssemblyError` naming the
 *   missing locale face, so a card that reached this render always holds a callable
 *   `t`: a fallback branch here would be unreachable, and asserting one would hide
 *   that assembly failure instead of reporting it.
 */
export type ConfigCardProps = InjectFace<CardFace> &
  PropsLocale<"dsh-doc-impact">;

/**
 * Everything the row seat hands its entry: {@link ConfigCardProps} plus
 * `PropsRuntime<"plugins.row.config">`, whose owner share is the `view`
 * discriminator and the page's `form`, read straight from the contract the Plugins
 * page merges into `SlotMap`. This is the composition the seat's own `register`
 * call checks a component against, so a seat that stops handing over a member
 * becomes a type error in this file rather than a `TypeError` in the row.
 *
 * Of those props the card reads no `form`. The page's `form` is a `ConfigPageForm`
 * — `{ state, mutate }`, whose `state` is the one `getSnapshot()` the page took
 * while it rendered, and the page re-renders when the roster of served namespaces
 * moves, not when this document is written. This card has to follow a write it did
 * not make (an entry config edited elsewhere, the same namespace open in another
 * surface), so it reads and fences the document through the `ConfigForm` the
 * bootstrap resolves and takes nothing from that prop.
 * `tests/client-bundle.test.ts` hands the entry a live page form, so the non-use
 * stays a decision someone can see fail rather than an unread prop. It is also why
 * {@link CardFace} must carry no member named `form`: the renderer spreads the
 * owner props after the injected face, so the page's narrower form would shadow the
 * card's own — the same rule `dsh-model-safety-gate` honors by naming its face
 * member `settingsForm`.
 */
export type RowEntryProps = PropsRuntime<"plugins.row.config"> &
  ConfigCardProps;

/**
 * The one-liner of this bundle's row — kept equal to the `description` field of
 * `package.json`, which is where the Host reads a row's sentence from
 * (`docs/DSH-0.1.7-MIGRATION.md` §4.2, `presentation.ts:127-131`). That also says
 * when this answer is reached: the page writes `description ?? renderSlot(…)` into
 * its own `<p>`, so while the manifest carries the field the seat is never asked,
 * and the sentence below is the fallback the contract owes a row that declares no
 * description rather than the row's normal line. It is text and nothing else — the
 * page puts it inside a paragraph — and it reads no settings state, so no second
 * copy of the form mounts in a line of heading text.
 * `tests/client-bundle.test.ts` and `tests/client-render.test.ts` compare this reply
 * against the manifest field itself rather than against a copy of this string, so an
 * edit to the manifest cannot be missed here.
 */
const ROW_SUMMARY =
  "Deterministic documentation impact engine for DeepSeek Harness";

export function ConfigCard(props: ConfigCardProps) {
  const state = props.useDocImpactCard(function (snapshot) {
    return snapshot;
  });
  const t = props.t;
  // The page owns the frame, so returning nothing here would leave the reader inside
  // an opened row with no section at all and no reason. A card that draws its own
  // shell can stay invisible; a body mounted in the Host's chrome owes a sentence.
  if (!state.available) {
    return createElement(
      "p",
      { className: "ddi_notice", role: "status" },
      t("unavailable"),
    );
  }
  const blocked = !state.dirty || state.invalid || state.saving;
  const disabled = !state.writable || state.saving;
  const fields = state.fields;
  return createElement(
    "div",
    { className: "ddi_body" },
    !state.writable
      ? createElement(
          "p",
          { className: "ddi_notice", role: "status" },
          t("readOnly"),
        )
      : null,
    createElement(BoolField, {
      t: t,
      id: "doc-impact-enabled",
      labelKey: "enabledLabel",
      hintKey: "enabledHint",
      fallback: true,
      state: fields.enabled,
      disabled: disabled,
      onChoose: function (value: boolean) {
        props.choose("enabled", value);
      },
      onReset: function () {
        props.resetField("enabled");
      },
    }),
    createElement(BoolField, {
      t: t,
      id: "doc-impact-steer",
      labelKey: "steerLabel",
      hintKey: "steerHint",
      fallback: true,
      state: fields.steer,
      disabled: disabled,
      onChoose: function (value: boolean) {
        props.choose("steer", value);
      },
      onReset: function () {
        props.resetField("steer");
      },
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
      },
    }),
    createElement<ChoiceProps<ModeOption>>(ChoiceField, {
      t: t,
      id: "doc-impact-mode",
      labelKey: "modeLabel",
      hintKey: "modeHint",
      options: MODE_OPTIONS,
      fallback: "remind",
      state: fields.mode,
      disabled: disabled,
      onChoose: function (value: ModeOption) {
        props.choose("mode", value);
      },
      onReset: function () {
        props.resetField("mode");
      },
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
      },
    }),
    createElement<ChoiceProps<OnLimitOption>>(ChoiceField, {
      t: t,
      id: "doc-impact-on-limit",
      labelKey: "onLimitLabel",
      hintKey: "onLimitHint",
      options: ON_LIMIT_OPTIONS,
      fallback: "allow",
      state: fields.onLimit,
      disabled: disabled,
      onChoose: function (value: OnLimitOption) {
        props.choose("onLimit", value);
      },
      onReset: function () {
        props.resetField("onLimit");
      },
    }),
    createElement(TextAreaField, {
      t: t,
      id: "doc-impact-reminder-template",
      labelKey: "reminderTemplateLabel",
      hintKey: "reminderTemplateHint",
      rows: 9,
      state: fields.reminderTemplate,
      disabled: disabled,
      onEdit: function (text: string) {
        props.edit("reminderTemplate", text);
      },
      onReset: function () {
        props.resetField("reminderTemplate");
      },
    }),
    createElement(TextAreaField, {
      t: t,
      id: "doc-impact-limit-template",
      labelKey: "limitTemplateLabel",
      hintKey: "limitTemplateHint",
      rows: 7,
      state: fields.limitTemplate,
      disabled: disabled,
      onEdit: function (text: string) {
        props.edit("limitTemplate", text);
      },
      onReset: function () {
        props.resetField("limitTemplate");
      },
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
      },
    }),
    createElement(BoolField, {
      t: t,
      id: "doc-impact-debug",
      labelKey: "debugLabel",
      hintKey: "debugHint",
      fallback: false,
      state: fields.debug,
      disabled: disabled,
      onChoose: function (value: boolean) {
        props.choose("debug", value);
      },
      onReset: function () {
        props.resetField("debug");
      },
    }),
    createElement(
      "div",
      { className: "ddi_footer" },
      state.failed
        ? createElement(
            "p",
            { className: "ddi_failed", role: "status" },
            t("saveFailed"),
          )
        : null,
      // The header that used to carry this marker is the page's now, so the draft
      // count travels with the controls it enables instead.
      state.dirty
        ? createElement("span", { className: "ddi_badge" }, t("unsaved"))
        : null,
      createElement(
        "button",
        {
          type: "button",
          className: "ddi_discard",
          disabled: !state.dirty || state.saving,
          onClick: props.discard,
        },
        t("discard"),
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "ddi_save",
          disabled: blocked,
          onClick: props.save,
        },
        t(state.saving ? "saving" : "save"),
      ),
    ),
  );
}

/**
 * The entry `plugins.row.config` registers. The seat answers two views: the
 * configuration section as `{ view: 'page', form }`, and the row's one-liner as
 * `{ view: 'summary' }` for a row that carries no display description of its own
 * ({@link ROW_SUMMARY}). The two are separated here rather than by an early return
 * inside {@link ConfigCard}, which is what keeps each view its own hook order: the
 * card reads the settings state, the one-liner reads none and mounts nothing, so a
 * line of heading text never gets a second live copy of the form inside it.
 */
export function RowConfigEntry(props: RowEntryProps) {
  if (props.view === "summary") return ROW_SUMMARY;
  return createElement(ConfigCard, props);
}
