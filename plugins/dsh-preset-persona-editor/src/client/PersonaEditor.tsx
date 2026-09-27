/**
 * The preset reader: the persona's four fields as they are composed today, the
 * advanced prompt-sections area, and the disclosures a composition carries.
 *
 * The body only ever renders for the preset the roster opened, and it renders
 * nothing it cannot back with a fact. The two failures a preset can carry stay
 * two sentences: `broken` is the registry's own reason that no session composes
 * from this preset, and it does not stop the readings below from being real;
 * `readError` is the reason there are no readings. A row that carries keys this
 * page does not describe says so. Nothing here can be typed into — the Host has
 * no durable preset-authoring path, so the page reads.
 * @module client/PersonaEditor
 */

import { useId, type ReactElement } from "react";

import { FIRST_PARTY_NAME_HINT } from "../shared/prompt-sections.js";
import type { PersonaDocument } from "../types.js";
import { PersonaPreview } from "./PersonaPreview.js";
import { strings } from "./locale.js";
import type { PersonaPageController, PersonaPageSnapshot } from "./store.js";

/**
 * One labelled text reading.
 *
 * The label is tied to the control by `for` rather than by wrapping it: a
 * wrapping label makes the control's accessible name every text inside it, and
 * the hint that explains a reading is not part of its name. The hint stays
 * reachable, as a description.
 */
function Field(props: {
  readonly testId: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly rows: number;
}): ReactElement {
  const id = useId();
  return (
    <div className="preset-persona__field">
      <label className="preset-persona__label" htmlFor={id}>
        {props.label}
      </label>
      <textarea
        id={id}
        className="preset-persona__textarea"
        rows={props.rows}
        value={props.value}
        readOnly
        aria-describedby={`${id}-hint`}
        data-testid={props.testId}
        spellCheck={false}
      />
      <span className="preset-persona__hint" id={`${id}-hint`}>
        {props.hint}
      </span>
    </div>
  );
}

/** A state shown as a checkbox the user cannot change. */
function Check(props: {
  readonly testId: string;
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
}): ReactElement {
  const id = useId();
  return (
    <div className="preset-persona__check">
      <input
        id={id}
        type="checkbox"
        checked={props.checked}
        disabled
        aria-describedby={`${id}-hint`}
        data-testid={props.testId}
        readOnly
      />
      <span className="preset-persona__check-text">
        <label className="preset-persona__label" htmlFor={id}>
          {props.label}
        </label>
        <span className="preset-persona__hint" id={`${id}-hint`}>
          {props.hint}
        </span>
      </span>
    </div>
  );
}

/** One section of the advanced area: its values and what it says about them. */
function SectionRow(props: {
  readonly section: PersonaDocument["sections"][number];
}): ReactElement {
  const { section } = props;
  const id = useId();
  return (
    <li
      className="preset-persona__section-row"
      data-testid="persona-section-row"
    >
      <div className="preset-persona__row">
        <div className="preset-persona__field preset-persona__field--tight">
          <label className="preset-persona__label" htmlFor={`${id}-name`}>
            {strings.sectionNameLabel}
          </label>
          <input
            id={`${id}-name`}
            className="preset-persona__input"
            value={section.name}
            readOnly
            data-testid="persona-section-name"
            spellCheck={false}
          />
        </div>
        <div className="preset-persona__field preset-persona__field--tight">
          <label className="preset-persona__label" htmlFor={`${id}-order`}>
            {strings.sectionOrderLabel}
          </label>
          <input
            id={`${id}-order`}
            className="preset-persona__input"
            value={Number.isInteger(section.order) ? String(section.order) : ""}
            readOnly
            data-testid="persona-section-order"
          />
        </div>
        <div className="preset-persona__check">
          <input
            id={`${id}-enabled`}
            type="checkbox"
            checked={section.enabled}
            disabled
            readOnly
            data-testid="persona-section-enabled"
          />
          <label className="preset-persona__label" htmlFor={`${id}-enabled`}>
            {strings.sectionEnabledLabel}
          </label>
        </div>
      </div>
      <div className="preset-persona__field">
        <label className="preset-persona__label" htmlFor={`${id}-text`}>
          {strings.sectionTextLabel}
        </label>
        <textarea
          id={`${id}-text`}
          className="preset-persona__textarea"
          rows={3}
          value={section.text}
          readOnly
          data-testid="persona-section-text"
          spellCheck={false}
        />
      </div>
      {FIRST_PARTY_NAME_HINT.test(section.name) ? (
        <p className="preset-persona__warn" data-testid="persona-section-warn">
          {strings.sectionFirstPartyName}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The advanced area: the sections this preset contributes.
 *
 * It is a disclosure rather than a second page: a preset usually has none, the
 * ones that do are the power-user case, and keeping them inside the same card
 * means one reading covers both halves of the preset's prompt.
 */
function SectionsArea(props: {
  readonly document: PersonaDocument;
}): ReactElement {
  const { document } = props;
  return (
    <details
      className="preset-persona__details preset-persona__section"
      data-testid="persona-sections"
    >
      <summary>{strings.sectionsTitle}</summary>
      <p className="preset-persona__hint">{strings.sectionsHint}</p>
      <p className="preset-persona__hint">{strings.sectionsKeeps}</p>
      {document.sectionsError === "" ? null : (
        <p
          className="preset-persona__error"
          data-testid="persona-sections-error"
        >
          {strings.sectionsError} {document.sectionsError}
        </p>
      )}
      {document.sectionsState === "ambiguous" ? (
        <p
          className="preset-persona__error"
          data-testid="persona-sections-ambiguous"
        >
          {strings.sectionsAmbiguous}
        </p>
      ) : null}
      {document.sectionsUnknownKeys.length === 0 ? null : (
        <p
          className="preset-persona__hint"
          data-testid="persona-sections-unknown-keys"
        >
          {strings.sectionsUnknownKeys}:{" "}
          {document.sectionsUnknownKeys.map((key) => (
            <code key={key} className="preset-persona__code">
              {key}
            </code>
          ))}{" "}
          — {strings.unknownKeysHint}
        </p>
      )}
      {document.sections.length === 0 ? (
        <p
          className="preset-persona__hint"
          data-testid="persona-sections-empty"
        >
          {strings.sectionsEmpty}
        </p>
      ) : (
        <ul
          className="preset-persona__list"
          data-testid="persona-sections-list"
        >
          {/* A hand-edited composition can declare two sections under one name,
              so the name alone is not an identity React can tell rows apart by. */}
          {document.sections.map((section, index) => (
            <SectionRow
              key={`${section.name}:${String(index)}`}
              section={section}
            />
          ))}
        </ul>
      )}
    </details>
  );
}

/** The disclosures about what the row carries beyond this page's four keys. */
function Disclosures(props: {
  readonly document: PersonaDocument;
}): ReactElement | null {
  const { document } = props;
  const hasUnknown = document.unknownKeys.length > 0;
  const hasForeign = document.foreignKeys.length > 0;
  const hasExtras = document.extraRows > 0;
  if (!hasUnknown && !hasForeign && !hasExtras) return null;
  return (
    <div className="preset-persona__section" data-testid="persona-disclosures">
      {hasUnknown ? (
        <p className="preset-persona__hint" data-testid="persona-unknown-keys">
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
        <p className="preset-persona__error" data-testid="persona-foreign-keys">
          {strings.foreignKeysTitle}: {document.foreignKeys.join(", ")}.{" "}
          {strings.foreignKeysHint}
        </p>
      ) : null}
      {hasExtras ? (
        <p className="preset-persona__error" data-testid="persona-extra-rows">
          {strings.extraRowsTitle}: {strings.extraRowsHint}
        </p>
      ) : null}
    </div>
  );
}

/** The reader body of the open preset. */
export function PersonaEditor(props: {
  readonly state: PersonaPageSnapshot;
  readonly controller: PersonaPageController;
}): ReactElement {
  const { state, controller } = props;
  const open = state.open;

  if (open === null || open.status === "loading") {
    return (
      <p className="preset-persona__intro" data-testid="persona-editor-loading">
        {strings.loading}
      </p>
    );
  }
  if (open.status === "failed" || open.document === null) {
    return (
      <p className="preset-persona__error" data-testid="persona-editor-error">
        {open.error}
      </p>
    );
  }
  const { document } = open;

  return (
    <>
      {document.broken === "" ? null : (
        <p className="preset-persona__error" data-testid="persona-broken">
          {strings.brokenTitle}: {document.broken}
        </p>
      )}

      {document.readError === "" ? null : (
        <p className="preset-persona__error" data-testid="persona-read-error">
          {strings.unreadable} {document.readError}
        </p>
      )}

      <Field
        testId="persona-prefix"
        label={strings.prefixLabel}
        hint={strings.prefixHint}
        value={document.persona.prefix}
        rows={7}
      />
      <Field
        testId="persona-suffix"
        label={strings.suffixLabel}
        hint={strings.suffixHint}
        value={document.persona.suffix}
        rows={3}
      />

      <Check
        testId="persona-complete"
        label={strings.completeLabel}
        hint={strings.completeHint}
        checked={document.persona.complete}
      />
      {document.persona.complete ? (
        <p
          className="preset-persona__warn"
          data-testid="persona-complete-warning"
        >
          {strings.completeWarning}
        </p>
      ) : null}

      <Check
        testId="persona-runtime-context"
        label={strings.runtimeLabel}
        hint={strings.runtimeHint}
        checked={document.persona.includeRuntimeContext}
      />

      <SectionsArea document={document} />

      <Disclosures document={document} />

      <div className="preset-persona__actions">
        <button
          type="button"
          className="preset-persona__button"
          data-testid="persona-reload"
          onClick={() => void controller.reload()}
        >
          {strings.reload}
        </button>
      </div>

      <PersonaPreview document={document} />
    </>
  );
}
