/**
 * The persona editor: the four fields, the actions, and the disclosures a
 * write needs.
 *
 * The body only ever renders for the preset the roster opened, and it renders
 * nothing it cannot back with a fact: a preset whose file cannot be parsed
 * shows the reason instead of an editor, a shipped preset shows the way to a
 * copy instead of dead fields, and a row that carries keys this editor does
 * not own says so before the user saves.
 * @module client/PersonaEditor
 */

import type { ReactElement } from "react";

import type { PersonaDocument } from "../types.js";
import { PersonaPreview } from "./PersonaPreview.js";
import { strings } from "./locale.js";
import {
  isDirty,
  type PersonaPageController,
  type PersonaPageSnapshot,
} from "./store.js";

/** One labelled text field. */
function Field(props: {
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly rows: number;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <label className="preset-persona__field">
      <span className="preset-persona__label">{props.label}</span>
      <textarea
        className="preset-persona__textarea"
        rows={props.rows}
        value={props.value}
        disabled={props.disabled}
        spellCheck={false}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      <span className="preset-persona__hint">{props.hint}</span>
    </label>
  );
}

/** A checkbox with its own explanation, as a block the user can scan. */
function Check(props: {
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <label className="preset-persona__check">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
      />
      <span className="preset-persona__check-text">
        <span className="preset-persona__label">{props.label}</span>
        <span className="preset-persona__hint">{props.hint}</span>
      </span>
    </label>
  );
}

/** The copy form, shown for a preset the deployment owns. */
function CopyForm(props: {
  readonly state: PersonaPageSnapshot;
  readonly controller: PersonaPageController;
}): ReactElement | null {
  const draft = props.state.copyDraft;
  if (draft === null) return null;
  return (
    <div className="preset-persona__section">
      <p className="preset-persona__section-title">{strings.copyTitle}</p>
      <p className="preset-persona__hint">{strings.copyHint}</p>
      <div className="preset-persona__row">
        <label className="preset-persona__field">
          <span className="preset-persona__label">{strings.copyIdLabel}</span>
          <input
            className="preset-persona__input"
            value={draft.id}
            spellCheck={false}
            onChange={(event) => {
              props.controller.editCopy({ id: event.target.value });
            }}
          />
        </label>
        <label className="preset-persona__field">
          <span className="preset-persona__label">{strings.copyNameLabel}</span>
          <input
            className="preset-persona__input"
            value={draft.name}
            onChange={(event) => {
              props.controller.editCopy({ name: event.target.value });
            }}
          />
        </label>
      </div>
      {draft.error === "" ? null : (
        <p className="preset-persona__error">{draft.error}</p>
      )}
      <div className="preset-persona__actions">
        <button
          type="button"
          className="preset-persona__button preset-persona__button--primary"
          disabled={draft.busy}
          onClick={() => void props.controller.copy()}
        >
          {draft.busy ? strings.copying : strings.copyAction}
        </button>
        <button
          type="button"
          className="preset-persona__button"
          onClick={() => {
            props.controller.cancelCopy();
          }}
        >
          {strings.close}
        </button>
      </div>
    </div>
  );
}

/** The disclosures about what the row carries beyond this editor's four keys. */
function Disclosures(props: {
  readonly document: PersonaDocument;
}): ReactElement | null {
  const { document } = props;
  const hasUnknown = document.unknownKeys.length > 0;
  const hasForeign = document.foreignKeys.length > 0;
  const hasExtras = document.extraRows > 0;
  if (!hasUnknown && !hasForeign && !hasExtras) return null;
  return (
    <div className="preset-persona__section">
      {hasUnknown ? (
        <p className="preset-persona__hint">
          <span className="preset-persona__section-title">
            {strings.unknownKeysTitle}
          </span>{" "}
          {document.unknownKeys.map((key) => (
            <code key={key} className="preset-persona__code">
              {key}
            </code>
          ))}{" "}
          — {strings.unknownKeysHint}
        </p>
      ) : null}
      {hasForeign ? (
        <p className="preset-persona__error">
          {strings.foreignKeysTitle}: {document.foreignKeys.join(", ")}.{" "}
          {strings.foreignKeysHint}
        </p>
      ) : null}
      {hasExtras ? (
        <p className="preset-persona__error">
          {strings.extraRowsTitle}: {strings.extraRowsHint}
        </p>
      ) : null}
    </div>
  );
}

/** The editor body of the open preset. */
export function PersonaEditor(props: {
  readonly state: PersonaPageSnapshot;
  readonly controller: PersonaPageController;
}): ReactElement {
  const { state, controller } = props;
  const open = state.open;

  if (open === null || open.status === "loading") {
    return <p className="preset-persona__intro">{strings.loading}</p>;
  }
  if (
    open.status === "failed" ||
    open.document === null ||
    open.draft === null
  ) {
    return <p className="preset-persona__error">{open.error}</p>;
  }
  const { document, draft } = open;
  const editable =
    document.editable && document.readError === "" && document.extraRows === 0;
  const dirty = isDirty(open);
  const shipped = document.trust === "system";

  return (
    <>
      <div className="preset-persona__meta">
        <p className="preset-persona__path">
          {strings.pathLabel}: <code>{document.path}</code>
        </p>
      </div>

      {document.readError === "" ? null : (
        <p className="preset-persona__error">
          {strings.unreadable} {document.readError}
        </p>
      )}

      {editable ? null : (
        <p className="preset-persona__warn">
          {shipped ? strings.readOnlyShipped : strings.unreadable}
        </p>
      )}

      <Field
        label={strings.prefixLabel}
        hint={strings.prefixHint}
        value={draft.prefix}
        rows={7}
        disabled={!editable}
        onChange={(prefix) => {
          controller.edit({ prefix });
        }}
      />
      <Field
        label={strings.suffixLabel}
        hint={strings.suffixHint}
        value={draft.suffix}
        rows={3}
        disabled={!editable}
        onChange={(suffix) => {
          controller.edit({ suffix });
        }}
      />

      <Check
        label={strings.completeLabel}
        hint={strings.completeHint}
        checked={draft.complete}
        disabled={!editable}
        onChange={(complete) => {
          controller.edit({ complete });
        }}
      />
      {draft.complete ? (
        <p className="preset-persona__warn">{strings.completeWarning}</p>
      ) : null}

      <Check
        label={strings.runtimeLabel}
        hint={strings.runtimeHint}
        checked={draft.includeRuntimeContext}
        disabled={!editable}
        onChange={(includeRuntimeContext) => {
          controller.edit({ includeRuntimeContext });
        }}
      />

      <Disclosures document={document} />

      <div className="preset-persona__actions">
        <button
          type="button"
          className="preset-persona__button preset-persona__button--primary"
          disabled={!editable || !dirty || state.busy}
          onClick={() => void controller.save()}
        >
          {state.busy ? strings.saving : strings.save}
        </button>
        <button
          type="button"
          className="preset-persona__button"
          disabled={!editable || !dirty || state.busy}
          onClick={() => {
            controller.revert();
          }}
        >
          {strings.revert}
        </button>
        <button
          type="button"
          className="preset-persona__button"
          disabled={!editable || state.busy || !document.hasRow}
          onClick={() => void controller.reset()}
        >
          {open.pendingReset ? `${strings.reset}?` : strings.reset}
        </button>
        <button
          type="button"
          className="preset-persona__button"
          onClick={() => void controller.reload()}
        >
          {strings.reload}
        </button>
        {shipped && state.authorable ? (
          <button
            type="button"
            className="preset-persona__button"
            onClick={() => {
              controller.beginCopy();
            }}
          >
            {strings.copyTitle}
          </button>
        ) : null}
      </div>

      <CopyForm state={state} controller={controller} />

      <PersonaPreview document={document} draft={draft} />
    </>
  );
}
