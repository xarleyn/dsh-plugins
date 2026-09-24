/**
 * The credential-help section of the operator card: where a deployment
 * replaces a provider's built-in "where do I get this token" hints with its
 * own. One provider override is the same field list for every provider — the
 * provider name is the only variable.
 */

import type { ReactElement } from "react";
import {
  StringListField,
  TextField,
  Toggle,
  type ControlProps,
} from "../operator-controls.js";
import { rawBool, rawString, rawStringList } from "./shared.js";

/** One provider's credential-help override: every field optional, every miss keeps the built-in help. */
export function CredentialHelpSection(props: {
  provider: string;
  override: Record<string, unknown>;
  disabled: boolean;
  write: (path: readonly string[], value: unknown) => void;
  unset: (path: readonly string[]) => void;
  overridden: (path: readonly string[]) => boolean;
}): ReactElement {
  const base = ["credentialHelp", props.provider] as const;
  const control: ControlProps = {
    disabled: props.disabled,
    write: props.write,
    unset: props.unset,
    overridden: props.overridden,
  };
  return (
    <details className="qai-op__subsection">
      <summary className="qai-op__section-summary">
        <span className="qai-op__section-title">{props.provider}</span>
        {Object.keys(props.override).length === 0 ? (
          <span className="qai-op__hint">встроенная подсказка</span>
        ) : (
          <span className="qai-op__overridden">переопределено</span>
        )}
      </summary>
      <div className="qai-op__section-body">
        <div className="qai-op__grid">
          <Toggle
            label="Подсказка показывается"
            path={[...base, "enabled"]}
            value={rawBool(props.override.enabled, true)}
            disabled={props.disabled}
            write={props.write}
          />
          <TextField
            label="Механизм (kind)"
            path={[...base, "kind"]}
            value={rawString(props.override.kind)}
            {...control}
          />
          <TextField
            label="Название"
            path={[...base, "label"]}
            value={rawString(props.override.label)}
            {...control}
          />
          <TextField
            label="Где получить токен (адрес)"
            path={[...base, "obtainUrl"]}
            value={rawString(props.override.obtainUrl)}
            placeholder="https://wiki.example.corp/tokens"
            {...control}
          />
          <TextField
            label="Где получить токен (подпись)"
            path={[...base, "obtainLabel"]}
            value={rawString(props.override.obtainLabel)}
            {...control}
          />
          <TextField
            label="Документация (адрес)"
            path={[...base, "docsUrl"]}
            value={rawString(props.override.docsUrl)}
            {...control}
          />
          <TextField
            label="Документация (подпись)"
            path={[...base, "docsLabel"]}
            value={rawString(props.override.docsLabel)}
            {...control}
          />
          <TextField
            label="Инструкция"
            path={[...base, "instructions"]}
            value={rawString(props.override.instructions)}
            {...control}
          />
          <TextField
            label="Ключ локализации инструкции"
            path={[...base, "instructionsLocaleKey"]}
            value={rawString(props.override.instructionsLocaleKey)}
            {...control}
          />
          <StringListField
            label="Скоупы"
            path={[...base, "scopes"]}
            values={rawStringList(props.override.scopes)}
            placeholder="read_user"
            {...control}
          />
          <StringListField
            label="Заметки"
            path={[...base, "notes"]}
            values={rawStringList(props.override.notes)}
            placeholder="токен живёт один год"
            {...control}
          />
          <Toggle
            label="Self-hosted"
            path={[...base, "selfHosted"]}
            value={rawBool(props.override.selfHosted, false)}
            disabled={props.disabled}
            write={props.write}
          />
        </div>
      </div>
    </details>
  );
}
