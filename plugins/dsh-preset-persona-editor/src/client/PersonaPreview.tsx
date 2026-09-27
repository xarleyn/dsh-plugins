/**
 * The preview: what the preset composes today, in the readings the spec calls
 * for.
 *
 * "Persona config" is exact — it renders the block in the shape the composition
 * carries it, through the same renderer the host-side writer of the 0.1.5 build
 * used, and the same holds for the prompt-sections block. "Effective prompt
 * structure" is an outline: the harness assembles a prompt from ordered
 * sections, and this shows where this preset's contributions land among them.
 * The order numbers come from the host's own order table, never from a constant
 * copied into the browser; the outline is labelled approximate because a
 * preset's other plugins register sections this page cannot see without
 * mounting it.
 * @module client/PersonaPreview
 */

import type { ReactElement } from "react";

import { renderSectionsList } from "../shared/prompt-sections.js";
import { renderConfigBlock } from "../shared/render.js";
import type { PersonaDocument } from "../types.js";
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
 * The fixed rows are the harness's own vocabulary; the preset's sections are
 * placed among them by their own order.
 * @param document - the open preset.
 * @returns the outline rows in ascending order.
 */
function outlineEntries(document: PersonaDocument): readonly OutlineEntry[] {
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
      text: document.persona.includeRuntimeContext
        ? strings.outlineContext
        : strings.outlineContextOff,
      active: false,
      muted: !document.persona.includeRuntimeContext,
    },
    {
      order: document.suffixOrder,
      text: local ? strings.outlineSuffix : strings.outlineInheritedSuffix,
      active: local,
      muted: !local,
    },
  ];
  for (const section of document.sections) {
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
  // Ties keep the row that came first, which is what a reader expects of an
  // outline that is comparing two presets side by side.
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
    <li className={className} data-testid="persona-outline-row">
      <span className="preset-persona__order">{String(entry.order)}</span>
      <span className="preset-persona__outline-text">{entry.text}</span>
    </li>
  );
}

/** The preview panel of one open preset. */
export function PersonaPreview(props: {
  readonly document: PersonaDocument;
}): ReactElement {
  const { document } = props;
  return (
    <div className="preset-persona__section" data-testid="persona-preview">
      <p className="preset-persona__section-title">{strings.previewTitle}</p>

      <p className="preset-persona__hint">{strings.previewStructureHint}</p>
      <ul className="preset-persona__outline" data-testid="persona-outline">
        {outlineEntries(document).map((entry, index) => (
          <OutlineRow
            key={`${String(entry.order)}-${entry.text}-${String(index)}`}
            entry={entry}
          />
        ))}
      </ul>
      {document.persona.complete ? (
        <p
          className="preset-persona__warn"
          data-testid="persona-outline-complete"
        >
          {strings.outlineComplete} {strings.outlineSuppressed}
        </p>
      ) : null}
      <p className="preset-persona__hint">
        {strings.outlineRows(document.rowCount)}
      </p>

      <details
        className="preset-persona__details"
        data-testid="persona-preview-config"
      >
        <summary>{strings.previewConfig}</summary>
        <pre className="preset-persona__pre">
          {renderConfigBlock(document.persona, 4, "\n").trimEnd()}
        </pre>
      </details>

      {document.sections.length === 0 ? null : (
        <details
          className="preset-persona__details"
          data-testid="persona-preview-sections"
        >
          <summary>{strings.sectionsPreview}</summary>
          <pre className="preset-persona__pre">
            {renderSectionsList(document.sections, 4, "\n")}
          </pre>
        </details>
      )}

      <details
        className="preset-persona__details"
        data-testid="persona-preview-composition"
      >
        <summary>{strings.compositionTitle}</summary>
        <p className="preset-persona__hint">{strings.compositionHint}</p>
        <pre className="preset-persona__pre">{document.source}</pre>
      </details>
    </div>
  );
}
