// Field renderers of the doc-impact settings card (createElement style,
// matching the classic ModuleLoader client convention of this plugin).
import { createElement, type ChangeEvent } from "react";
import type { LocaleKey, Translate } from "./dictionary.js";
import type { FieldState } from "./settings-form.js";

interface FieldProps {
  readonly t: Translate;
  readonly id: string;
  readonly labelKey: LocaleKey;
  readonly hintKey: LocaleKey;
  readonly state: FieldState;
  readonly disabled: boolean;
  readonly onReset: () => void;
}

/** The props of a field the card edits by typing. */
interface DraftProps extends FieldProps {
  readonly onEdit: (text: string) => void;
}

/** The props of the textarea that edits a steering template. */
interface TemplateProps extends DraftProps {
  readonly rows: number;
}

/**
 * The props of a field the card edits by picking: `V` is that field's
 * vocabulary, so the value handed back is always one of `options`.
 */
export interface ChoiceProps<V extends string> extends FieldProps {
  readonly options: readonly V[];
  readonly fallback: V;
  readonly onChoose: (value: V) => void;
}

/** The props of an on/off field. */
interface BoolProps extends FieldProps {
  readonly fallback: boolean;
  readonly onChoose: (value: boolean) => void;
}

export function FieldHead(
  t: Translate,
  id: string,
  labelKey: LocaleKey,
  state: FieldState,
  disabled: boolean,
  onReset: () => void,
) {
  return createElement(
    "div",
    { className: "ddi_head" },
    createElement(
      "label",
      { className: "ddi_label", htmlFor: id },
      t(labelKey),
    ),
    state.overridden
      ? createElement(
          "span",
          { className: "ddi_badges" },
          createElement("span", { className: "ddi_badge" }, t("overridden")),
          createElement(
            "button",
            {
              type: "button",
              className: "ddi_reset",
              disabled: disabled,
              onClick: onReset,
            },
            t("reset"),
          ),
        )
      : null,
  );
}

export function TextField(props: DraftProps) {
  const state = props.state;
  return createElement(
    "div",
    { className: "ddi_field" },
    FieldHead(
      props.t,
      props.id,
      props.labelKey,
      state,
      props.disabled,
      props.onReset,
    ),
    createElement("input", {
      id: props.id,
      className: state.invalid ? "ddi_input ddi_inputInvalid" : "ddi_input",
      type: "text",
      value: state.text,
      disabled: props.disabled,
      onChange: function (event: ChangeEvent<HTMLInputElement>) {
        props.onEdit(event.target.value);
      },
    }),
    createElement(
      "p",
      { className: state.invalid ? "ddi_invalid" : "ddi_hint" },
      state.invalid ? props.t("invalidValue") : props.t(props.hintKey),
    ),
  );
}

export function TextAreaField(props: TemplateProps) {
  const state = props.state;
  return createElement(
    "div",
    { className: "ddi_field" },
    FieldHead(
      props.t,
      props.id,
      props.labelKey,
      state,
      props.disabled,
      props.onReset,
    ),
    createElement("textarea", {
      id: props.id,
      className: state.invalid
        ? "ddi_input ddi_textarea ddi_inputInvalid"
        : "ddi_input ddi_textarea",
      rows: props.rows,
      spellCheck: false,
      value: state.text,
      disabled: props.disabled,
      onChange: function (event: ChangeEvent<HTMLTextAreaElement>) {
        props.onEdit(event.target.value);
      },
    }),
    createElement(
      "p",
      { className: state.invalid ? "ddi_invalid" : "ddi_hint" },
      state.invalid ? props.t("invalidTemplate") : props.t(props.hintKey),
    ),
  );
}

export function NumberField(props: DraftProps) {
  const state = props.state;
  return createElement(
    "div",
    { className: "ddi_field" },
    FieldHead(
      props.t,
      props.id,
      props.labelKey,
      state,
      props.disabled,
      props.onReset,
    ),
    createElement("input", {
      id: props.id,
      className: state.invalid ? "ddi_input ddi_inputInvalid" : "ddi_input",
      type: "text",
      inputMode: "numeric",
      "aria-invalid": state.invalid ? "true" : undefined,
      value: state.text,
      disabled: props.disabled,
      onChange: function (event: ChangeEvent<HTMLInputElement>) {
        props.onEdit(event.target.value);
      },
    }),
    createElement(
      "p",
      { className: state.invalid ? "ddi_invalid" : "ddi_hint" },
      state.invalid ? props.t("invalidNumber") : props.t(props.hintKey),
    ),
  );
}

export function ChoiceField<V extends string>(props: ChoiceProps<V>) {
  const state = props.state;
  const current = state.value === undefined ? props.fallback : state.value;
  return createElement(
    "div",
    { className: "ddi_field" },
    FieldHead(
      props.t,
      props.id,
      props.labelKey,
      state,
      props.disabled,
      props.onReset,
    ),
    createElement(
      "select",
      {
        id: props.id,
        className: "ddi_select",
        value: String(current),
        disabled: props.disabled,
        onChange: function (event: ChangeEvent<HTMLSelectElement>) {
          // The select offers nothing but `options`, so its text is one of them.
          props.onChoose(event.target.value as V);
        },
      },
      props.options.map(function (option: V) {
        return createElement("option", { key: option, value: option }, option);
      }),
    ),
    createElement("p", { className: "ddi_hint" }, props.t(props.hintKey)),
  );
}

export function BoolField(props: BoolProps) {
  const state = props.state;
  const current = state.value === undefined ? props.fallback : state.value;
  return createElement(
    "div",
    { className: "ddi_field" },
    FieldHead(
      props.t,
      props.id,
      props.labelKey,
      state,
      props.disabled,
      props.onReset,
    ),
    createElement(
      "select",
      {
        id: props.id,
        className: "ddi_select",
        value: current === true ? "true" : "false",
        disabled: props.disabled,
        onChange: function (event: ChangeEvent<HTMLSelectElement>) {
          props.onChoose(event.target.value === "true");
        },
      },
      createElement("option", { value: "true" }, props.t("on")),
      createElement("option", { value: "false" }, props.t("off")),
    ),
    createElement("p", { className: "ddi_hint" }, props.t(props.hintKey)),
  );
}
