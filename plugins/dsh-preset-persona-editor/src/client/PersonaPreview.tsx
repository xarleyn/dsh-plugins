/**
 * The preview: what the draft will look like once saved, in the readings the
 * spec calls for.
 *
 * "Persona config" is exact — it renders the very block the writer splices into
 * the composition, through the same renderer the host uses, and the same holds
 * for the prompt-sections block. "Effective prompt structure" is an outline:
 * the harness assembles its prompt from ordered sections, and this shows where
 * this preset's contributions land among them. The order numbers come from the
 * host's own order table, never from a constant copied into the browser; the
 * outline is labelled approximate because a preset's other plugins register
 * sections this page cannot see without mounting it.
 * @module client/PersonaPreview
 */

import type { ReactElement } from "react";

import { renderSectionsList } from "../shared/prompt-sections.js";
import { renderConfigBlock } from "../shared/render.js";
import type { PersonaDocument, PresetDraft } from "../types.js";
import { strings } from "./locale.js";

/** One row of the structure outline. */
interface OutlineEntry {
  readonly order: number;
  readonly text: string;
  /** A section this preset contributes (or its own persona). */
  readonly active: boolean;
  readonly muted: boolean;
}

/** The band the first-party and tool sections occupy, for placement only. */
const FIRST_PARTY_BAND = 5000;

/** The runtime-context block sits after the sections and before the suffix. */
const CONTEXT_PLACEMENT = 9000;

/**
 * The outline of the assembled prompt, sorted by the order the harness uses.
 *
 * The fixed rows are the harness's own vocabulary; the draft's sections are
 * placed among them by their own order, which is what makes the effect of an
 * order number visible before it is saved.
 * @param document - the open preset.
 * @param draft - the current draft.
 * @returns the outline rows in ascending order.
 */
function outlineEntries(
  document: PersonaDocument,
  draft: PresetDraft,
): readonly OutlineEntry[] {
  const local = document.hasRow;
  const entries: OutlineEntry[] = [
    { order: -1000, text: strings.outlineIdentity, active: false, muted: true },
    {
      order: document.prefixOrder,
      text: local ? strings.outlinePrefix : strings.outlineInheritedPrefix,
      active: local,
      muted: !local,
    },
    {
      order: FIRST_PARTY_BAND,
      text: strings.outlineFirstParty,
      active: false,
      muted: true,
    },
    {
      order: CONTEXT_PLACEMENT,
      text: draft.persona.includeRuntimeContext
        ? strings.outlineContext
        : strings.outlineContextOff,
      active: false,
      muted: !draft.persona.includeRuntimeContext,
    },
    {
      order: document.suffixOrder,
      text: local ? strings.outlineSuffix : strings.outlineInheritedSuffix,
      active: local,
      muted: !local,
    },
  ];
  for (const section of draft.sections) {
    const name = section.name === "" ? "…" : section.name;
    entries.push({
      order: Number.isFinite(section.order) ? section.order : FIRST_PARTY_BAND,
      text: section.enabled
        ? strings.outlineSection(name)
        : `${strings.outlineSection(name)} (${strings.outlineSectionOff})`,
      active: section.enabled,
      muted: !section.enabled,
    });
  }
  // Ties keep the row that came first, which is what a reader expects of a
  // list they are watching change: a section does not jump when it matches.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) =>
      left.entry.order === right.entry.order
        ? left.index - right.index
        : left.entry.order - right.entry.order,
    )
    .map((wrapped) => wrapped.entry);
}

/** One row of the structure outline. */
function OutlineRow(props: { readonly entry: OutlineEntry }): ReactElement {
  const { entry } = props;
  const className = entry.active
    ? "preset-persona__outline-row preset-persona__outline-row--active"
    : entry.muted
      ? "preset-persona__outline-row preset-persona__outline-row--muted"
      : "preset-persona__outline-row";
  return (
    <li className={className}>
      <span className="preset-persona__order">{String(entry.order)}</span>
      <span className="preset-persona__outline-text">{entry.text}</span>
    </li>
  );
}

/** The preview panel of one open preset. */
export function PersonaPreview(props: {
  readonly document: PersonaDocument;
  readonly draft: PresetDraft;
}): ReactElement {
  const { document, draft } = props;
  return (
    <div className="preset-persona__section">
      <p className="preset-persona__section-title">{strings.previewTitle}</p>

      <p className="preset-persona__hint">{strings.previewStructureHint}</p>
      <ul className="preset-persona__outline">
        {outlineEntries(document, draft).map((entry, index) => (
          <OutlineRow
            key={`${String(entry.order)}-${entry.text}-${String(index)}`}
            entry={entry}
          />
        ))}
      </ul>
      {draft.persona.complete ? (
        <p className="preset-persona__warn">
          {strings.outlineComplete} {strings.outlineSuppressed}
        </p>
      ) : null}
      <p className="preset-persona__hint">
        {strings.outlineRows(document.rowCount)}
      </p>

      <details className="preset-persona__details">
        <summary>{strings.previewConfig}</summary>
        <pre className="preset-persona__pre">
          {renderConfigBlock(draft.persona, 4, "\n").trimEnd()}
        </pre>
      </details>

      {draft.sections.length === 0 ? null : (
        <details className="preset-persona__details">
          <summary>{strings.sectionsPreview}</summary>
          <pre className="preset-persona__pre">
            {renderSectionsList(draft.sections, 4, "\n")}
          </pre>
        </details>
      )}

      <details className="preset-persona__details">
        <summary>{strings.fileTitle}</summary>
        <p className="preset-persona__hint">{strings.fileHint}</p>
        <pre className="preset-persona__pre">{document.source}</pre>
      </details>
    </div>
  );
}
