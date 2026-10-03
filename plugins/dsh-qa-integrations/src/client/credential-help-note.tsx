/**
 * The credential-help note as this bundle renders it.
 *
 * `@yadsh/dsh-plugin-kit` ships this note and every provider card here reuses
 * it, which this bundle can no longer do: the kit's trigger draws the card
 * shell's inline chevron (`ChevronDown`, whose path is the shell's), and a bundle
 * seated on the Plugins panel may not carry that path anywhere in itself — the
 * card-contract gate reads the built bytes, so importing the kit's note would take
 * this bundle red rather than restyling it. What the note *says* still comes from
 * the kit: `credentialHelpView` shapes the metadata and re-sanitizes each address
 * on this side of the wire, so only the markup is repeated here — with a
 * disclosure drawn the way this plugin draws its own collapsibles (a border
 * triangle, no glyph, no shell path) and under this bundle's own class names, so
 * the copy cannot fight the kit's sheet for the same selectors.
 *
 * The two are kept equal in content by
 * `tests/client/credential-help-note.test.tsx`, which renders this component and
 * the kit's side by side over one fixture and compares the text. That test, not a
 * promise about the kit, is what stops the copies drifting; the kit's note would
 * have to stop carrying the shell's chevron before this file could go away, and no
 * card owns that change yet.
 */

import {
  credentialHelpView,
  type CredentialHelpNoteProps,
} from "@yadsh/dsh-plugin-kit/client";
import { useId, useState, type ReactElement } from "react";

/** What the panel calls the permission list, as the kit's note calls it. */
const SCOPES_LABEL = "Требуемые права";

/** External help always leaves the app, so the opened page cannot reach back. */
function HelpLink({
  link,
  className,
}: {
  readonly link: { readonly url: string; readonly label: string };
  readonly className?: string;
}): ReactElement {
  return (
    <a
      {...(className === undefined ? {} : { className })}
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {link.label}
    </a>
  );
}

export function CredentialHelpNote({
  help,
  translate,
  className,
}: CredentialHelpNoteProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const view = credentialHelpView(help, translate);
  if (view === null) return null;
  const root =
    className === undefined
      ? "dsh-qa-integrations-help"
      : `dsh-qa-integrations-help ${className}`;
  if (!view.expandable) {
    const link = view.obtain ?? view.docs;
    if (link === undefined) return null;
    return (
      <p className={root}>
        <HelpLink link={link} className="dsh-qa-integrations-help__link" />
      </p>
    );
  }
  return (
    <div className={root}>
      <button
        type="button"
        className="dsh-qa-integrations-help__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {view.action}
        <span
          className="dsh-qa-integrations-help__chevron"
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="dsh-qa-integrations-help__panel" id={panelId}>
          {view.title === undefined ? null : (
            <p className="dsh-qa-integrations-help__title">{view.title}</p>
          )}
          {view.steps.length === 1 ? (
            <p className="dsh-qa-integrations-help__text">{view.steps[0]}</p>
          ) : view.steps.length > 1 ? (
            <ol className="dsh-qa-integrations-help__steps">
              {view.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          {view.scopes.length === 0 ? null : (
            <div className="dsh-qa-integrations-help__group">
              <span className="dsh-qa-integrations-help__label">
                {SCOPES_LABEL}
              </span>
              <ul className="dsh-qa-integrations-help__list">
                {view.scopes.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            </div>
          )}
          {view.notes.length === 0 ? null : (
            <ul className="dsh-qa-integrations-help__list">
              {view.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {view.obtain === undefined && view.docs === undefined ? null : (
            <div className="dsh-qa-integrations-help__links">
              {view.obtain === undefined ? null : (
                <HelpLink link={view.obtain} />
              )}
              {view.docs === undefined ? null : <HelpLink link={view.docs} />}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
