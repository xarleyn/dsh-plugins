import type { ReactElement } from "react";
import { useId, useState } from "react";
import type { CredentialHelp, CredentialHelpKind } from "../credential-help.js";
import { sanitizeCredentialHelpUrl } from "../credential-help.js";
import { ChevronDown } from "./chevron.js";

/**
 * What each credential mechanism is called in the UI, so a card never says
 * "Get a token" about an OAuth sign-in or an environment credential. A
 * deployment that needs other words overrides them in the metadata
 * (`obtain.label`, `docs.label`) instead of forking the component.
 */
export const CREDENTIAL_HELP_ACTIONS: Readonly<
  Record<CredentialHelpKind, string>
> = Object.freeze({
  "api-key": "Создать API-ключ",
  "personal-access-token": "Создать токен доступа",
  oauth: "Войти и авторизовать",
  "service-account": "Создать сервисный аккаунт",
  "app-password": "Создать пароль приложения",
  custom: "Как получить доступ",
});

/** Wording of the trigger when the help carries links but no obtain address. */
const SETUP_ACTION = "Как это настроить";

const DOCS_LABEL = "Документация";

const SCOPES_LABEL = "Требуемые права";

/**
 * A help value shaped for rendering: every address has been through the
 * sanitizer again, on the browser side, so a metadata payload that reached the
 * UI by some other route still cannot become a `javascript:` link.
 */
export interface CredentialHelpView {
  readonly action: string;
  readonly obtain: { readonly url: string; readonly label: string } | undefined;
  readonly docs: { readonly url: string; readonly label: string } | undefined;
  readonly title: string | undefined;
  readonly steps: readonly string[];
  readonly scopes: readonly string[];
  readonly notes: readonly string[];
  /** Whether a panel is worth opening, or the one link can stand alone. */
  readonly expandable: boolean;
}

function unique(values: readonly string[] | undefined): readonly string[] {
  if (values === undefined) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    items.push(trimmed);
  }
  return items;
}

/**
 * Turn metadata into the view the note renders, or `null` when there is nothing
 * to say — the plain credential field is then the whole story.
 *
 * `translate` resolves `instructionsLocaleKey` in the embedding application's
 * locale; without one, the inline `instructions` text is used, which keeps the
 * contract free of prose that would have to be translated inside metadata.
 */
export function credentialHelpView(
  help: CredentialHelp | null | undefined,
  translate?: (key: string) => string | undefined,
): CredentialHelpView | null {
  if (help === null || help === undefined) return null;
  const obtainUrl = sanitizeCredentialHelpUrl(help.obtain?.url ?? "", {
    selfHosted: help.selfHosted === true,
  });
  const docsUrl = sanitizeCredentialHelpUrl(help.docs?.url ?? "", {
    selfHosted: help.selfHosted === true,
  });
  const obtain =
    obtainUrl === undefined
      ? undefined
      : {
          url: obtainUrl,
          label:
            help.obtain?.label?.trim() || CREDENTIAL_HELP_ACTIONS[help.kind],
        };
  const docs =
    docsUrl === undefined
      ? undefined
      : { url: docsUrl, label: help.docs?.label?.trim() || DOCS_LABEL };
  if (obtain === undefined && docs === undefined) {
    // Without an address the note could still carry steps and permissions.
    const steps = unique(
      (help.instructions ?? "").split(/\r?\n/u).filter((line) => line !== ""),
    );
    const scopes = unique(help.scopes);
    const notes = unique(help.notes);
    if (steps.length === 0 && scopes.length === 0 && notes.length === 0) {
      return null;
    }
    return {
      action: SETUP_ACTION,
      obtain: undefined,
      docs: undefined,
      title: help.label?.trim() || undefined,
      steps,
      scopes,
      notes,
      expandable: true,
    };
  }
  const localized =
    help.instructionsLocaleKey === undefined
      ? undefined
      : translate?.(help.instructionsLocaleKey);
  const steps = unique(
    (localized ?? help.instructions ?? "")
      .split(/\r?\n/u)
      .filter((line) => line !== ""),
  );
  const scopes = unique(help.scopes);
  const notes = unique(help.notes);
  return {
    action: obtain?.label ?? docs?.label ?? SETUP_ACTION,
    obtain,
    docs,
    title: help.label?.trim() || undefined,
    steps,
    scopes,
    notes,
    // A single link with nothing to explain is rendered as the link itself;
    // a trigger that opens a panel repeating it would only cost a click.
    expandable:
      steps.length > 0 ||
      scopes.length > 0 ||
      notes.length > 0 ||
      (obtain !== undefined && docs !== undefined),
  };
}

export interface CredentialHelpNoteProps {
  /** Metadata as the Host declared it; `null` renders nothing at all. */
  readonly help: CredentialHelp | null | undefined;
  /** Locale lookup for `instructionsLocaleKey`, when the app has one. */
  readonly translate?: (key: string) => string | undefined;
  /** Extra class name for the surrounding plugin's own layout. */
  readonly className?: string;
}

function HelpLink({
  link,
  className,
}: {
  readonly link: { readonly url: string; readonly label: string };
  readonly className?: string;
}): ReactElement {
  // External help always leaves the app: `noopener`/`noreferrer` keep the opened
  // page from reaching back through `window.opener`.
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

/**
 * The credential field's helper: where to create the credential, what to grant
 * it and which documentation describes it. It renders inside any settings card
 * and carries no state beyond its own disclosure, so a card that has no
 * metadata simply renders the field it always did.
 */
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
      ? "dsh-credential-help"
      : `dsh-credential-help ${className}`;
  if (!view.expandable) {
    const link = view.obtain ?? view.docs;
    if (link === undefined) return null;
    return (
      <p className={root}>
        <HelpLink link={link} className="dsh-credential-help__link" />
      </p>
    );
  }
  return (
    <div className={root}>
      <button
        type="button"
        className="dsh-credential-help__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        {view.action}
        <ChevronDown className="dsh-credential-help__chevron" />
      </button>
      {open ? (
        <div className="dsh-credential-help__panel" id={panelId}>
          {view.title === undefined ? null : (
            <p className="dsh-credential-help__title">{view.title}</p>
          )}
          {view.steps.length === 1 ? (
            <p className="dsh-credential-help__text">{view.steps[0]}</p>
          ) : view.steps.length > 1 ? (
            <ol className="dsh-credential-help__steps">
              {view.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          {view.scopes.length === 0 ? null : (
            <div className="dsh-credential-help__group">
              <span className="dsh-credential-help__label">{SCOPES_LABEL}</span>
              <ul className="dsh-credential-help__list">
                {view.scopes.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            </div>
          )}
          {view.notes.length === 0 ? null : (
            <ul className="dsh-credential-help__list">
              {view.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {view.obtain === undefined && view.docs === undefined ? null : (
            <div className="dsh-credential-help__links">
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
