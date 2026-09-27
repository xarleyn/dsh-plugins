/**
 * The preset reader: the persona's four fields as they are composed today, the
 * advanced prompt-sections area, and the disclosures a composition carries.
 *
 * The body only ever renders for the preset the roster opened, and it renders
 * nothing it cannot back with a fact: a preset whose composition cannot be
 * parsed shows the reason instead of the readings, and a row that carries keys
 * this page does not describe says so. Nothing here can be typed into — the
 * Host has no durable preset-authoring path, so the page reads.
 * @module client/PersonaEditor
 */

import type { ReactElement } from "react";

import { FIRST_PARTY_NAME_HINT } from "../shared/prompt-sections.js";
import type { PersonaDocument, SectionsModuleState } from "../types.js";
import { PersonaPreview } from "./PersonaPreview.js";
import { strings } from "./locale.js";
import type { PersonaPageController, PersonaPageSnapshot } from "./store.js";

/** One labelled text reading. */
function Field(props: {
  readonly testId: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly rows: number;
}): ReactElement {
  return (
    <p className="preset-persona__field">
      <span className="preset-persona__label">{props.label}</span>
      <textarea
        className="preset-persona__textarea"
        rows={props.rows}
        value={props.value}
        readOnly
        data-testid={props.testId}
        spellCheck={false}
      />
      <span className="preset-persona__hint">{props.hint}</span>
    </p>
  );
}

/** A state shown as a checkbox the user cannot change. */
function Check(props: {
  readonly testId: string;
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
}): ReactElement {
  return (
    <p className="preset-persona__check">
      <input
        type="checkbox"
        checked={props.checked}
        disabled
        data-testid={props.testId}
        readOnly
      />
      <span className="preset-persona__check-text">
        <span className="preset-persona__label">{props.label}</span>
        <span className="preset-persona__hint">{props.hint}</span>
      </span>
    </p>
  );
}

/** One line about the registrar file the sections row names. */
function registrarLine(module: SectionsModuleState): string {
  switch (module) {
    case "present":
      return strings.sectionsModulePresent;
    case "foreign":
      return strings.sectionsModuleForeign;
    case "missing":
      return strings.sectionsModuleMissing;
    default:
      return strings.sectionsModuleUnknown;
  }
}

/** One section of the advanced area: its values and what it says about them. */
function SectionRow(props: {
  readonly section: PersonaDocument["sections"][number];
}): ReactElement {
  const { section } = props;
  return (
    <li
      className="preset-persona__section-row"
      data-testid="persona-section-row"
    >
      <div className="preset-persona__row">
        <p className="preset-persona__field preset-persona__field--tight">
          <span className="preset-persona__label">
            {strings.sectionNameLabel}
          </span>
          <input
            className="preset-persona__input"
            value={section.name}
            readOnly
            data-testid="persona-section-name"
            spellCheck={false}
          />
        </p>
        <p className="preset-persona__field preset-persona__field--tight">
          <span className="preset-persona__label">
            {strings.sectionOrderLabel}
          </span>
          <input
            className="preset-persona__input"
            value={Number.isInteger(section.order) ? String(section.order) : ""}
            readOnly
            data-testid="persona-section-order"
          />
        </p>
        <p className="preset-persona__check">
          <input
            type="checkbox"
            checked={section.enabled}
            disabled
            readOnly
            data-testid="persona-section-enabled"
          />
          <span className="preset-persona__label">
            {strings.sectionEnabledLabel}
          </span>
        </p>
      </div>
      <p className="preset-persona__field">
        <span className="preset-persona__label">
          {strings.sectionTextLabel}
        </span>
        <textarea
          className="preset-persona__textarea"
          rows={3}
          value={section.text}
          readOnly
          data-testid="persona-section-text"
          spellCheck={false}
        />
      </p>
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
      <p className="preset-persona__hint">
        {registrarLine(document.sectionsModule)}
      </p>
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
          {document.sections.map((section) => (
            <SectionRow key={section.name} section={section} />
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
  const readable = document.readError === "" && document.extraRows === 0;

  return (
    <>
      <div className="preset-persona__meta">
        <p className="preset-persona__path">
          {strings.pathLabel}: <code>{document.path}</code>
        </p>
      </div>

      {document.readError === "" ? null : (
        <p className="preset-persona__error" data-testid="persona-read-error">
          {strings.unreadable} {document.readError}
        </p>
      )}

      {readable ? null : (
        <p className="preset-persona__warn" data-testid="persona-read-only">
          {strings.unreadable}
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
