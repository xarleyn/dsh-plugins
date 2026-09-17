/**
 * The preview: what the persona will look like once saved, in the two readings
 * the spec calls for.
 *
 * "Persona config" is exact — it renders the very block the writer splices into
 * the composition, through the same renderer the host uses. "Effective prompt
 * structure" is an outline: the harness assembles its prompt from ordered
 * sections, and this shows where this persona lands among them. The order
 * numbers come from the host's own order table, never from a constant copied
 * into the browser; the outline is labelled approximate because a preset's
 * other plugins may add sections this page cannot see without mounting it.
 * @module client/PersonaPreview
 */

import type { ReactElement } from "react";

import { renderConfigBlock } from "../shared/render.js";
import type { PersonaDocument, PersonaDraft } from "../types.js";
import { strings } from "./locale.js";

/** One row of the structure outline. */
function OutlineRow(props: {
  readonly order: number | string;
  readonly text: string;
  readonly active: boolean;
  readonly muted?: boolean;
}): ReactElement {
  const className = props.active
    ? "preset-persona__outline-row preset-persona__outline-row--active"
    : props.muted === true
      ? "preset-persona__outline-row preset-persona__outline-row--muted"
      : "preset-persona__outline-row";
  return (
    <li className={className}>
      <span className="preset-persona__order">{props.order}</span>
      <span className="preset-persona__outline-text">{props.text}</span>
    </li>
  );
}

/** The effective-prompt outline for one draft. */
function Outline(props: {
  readonly document: PersonaDocument;
  readonly draft: PersonaDraft;
}): ReactElement {
  const { document, draft } = props;
  const local = document.hasRow;
  return (
    <ul className="preset-persona__outline">
      <OutlineRow
        order={-1000}
        text={strings.outlineIdentity}
        active={false}
        muted
      />
      <OutlineRow
        order={document.prefixOrder}
        text={local ? strings.outlinePrefix : strings.outlineInheritedPrefix}
        active={local}
        muted={!local}
      />
      <OutlineRow
        order={`…${document.suffixOrder}`}
        text={strings.outlineFirstParty}
        active={false}
        muted
      />
      <OutlineRow
        order="ctx"
        text={
          draft.includeRuntimeContext
            ? strings.outlineContext
            : strings.outlineContextOff
        }
        active={false}
        muted={!draft.includeRuntimeContext}
      />
      <OutlineRow
        order={document.suffixOrder}
        text={local ? strings.outlineSuffix : strings.outlineInheritedSuffix}
        active={local}
        muted={!local}
      />
    </ul>
  );
}

/** The preview panel of one open preset. */
export function PersonaPreview(props: {
  readonly document: PersonaDocument;
  readonly draft: PersonaDraft;
}): ReactElement {
  const { document, draft } = props;
  return (
    <div className="preset-persona__section">
      <p className="preset-persona__section-title">{strings.previewTitle}</p>

      <p className="preset-persona__hint">{strings.previewStructureHint}</p>
      <Outline document={document} draft={draft} />
      {draft.complete ? (
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
          {renderConfigBlock(draft, 4, "\n").trimEnd()}
        </pre>
      </details>

      <details className="preset-persona__details">
        <summary>{strings.fileTitle}</summary>
        <p className="preset-persona__hint">{strings.fileHint}</p>
        <pre className="preset-persona__pre">{document.source}</pre>
      </details>
    </div>
  );
}
