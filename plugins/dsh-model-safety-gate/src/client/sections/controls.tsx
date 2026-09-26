/**
 * Controls and props shared by the settings-plane sections.
 *
 * Every plane section gets the same props: the effective configuration plus the
 * path-addressed write / clear / override-check triple the card binds from the
 * settings scope, so a section never reaches for the scope itself.
 */

import type { ModelSafetyGateConfig } from "../../config.js";
import type { SafetyGateClassifierState } from "../../types.js";
import type { SectionProps } from "../components.js";

export interface ConfigProps extends SectionProps {
  readonly config: ModelSafetyGateConfig | undefined;
  /** Wiring state of the running classifier, when the Remote has answered. */
  readonly classifierState: SafetyGateClassifierState | null;
}

/** Small clearing control shown beside a section the user layer overrides. */
export function ResetButton(props: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="msg-btn link"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
