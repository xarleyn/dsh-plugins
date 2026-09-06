// Field renderers of the doc-impact settings card (createElement style,
// matching the classic ModuleLoader client convention of this plugin).
import { createElement } from "react";

export function FieldHead(t: any, id: string, labelKey: string, state: any, disabled: boolean, onReset: () => void) {
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

export function TextField(props: any) {
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

export function NumberField(props: any) {
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

export function ChoiceField(props: any) {
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

export function BoolField(props: any) {
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

