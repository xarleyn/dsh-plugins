/**
 * What every section of the Authenticated Web Fetch card shares: the client
 * face the card is injected with, and the small controls the sections build
 * their markup out of.
 *
 * No component here ever receives a credential value — the credential control
 * stages a write-only input and asks the credentials domain only for
 * configured/writable facts (SPEC §21).
 * @module client/sections/common
 */

import type { ReactNode } from "react";
import type { CredentialInfo } from "@deepseek-ai/dsh-credentials/types";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type {
  DiagnoseReport,
  ProviderStatusReport,
  RuleTestReport,
  WebFetchAuthConfig,
} from "../../types.js";

/** Client face of the Host `credentials` Remote namespace (values never ride it). */
export interface CredentialsRemote {
  describe(
    refs: string[],
  ): Promise<RemoteResult<Record<string, CredentialInfo>>>;
  set(ref: string, value: string): Promise<RemoteResult<void>>;
  unset(ref: string): Promise<RemoteResult<void>>;
}

/**
 * Client face injected into the card.
 *
 * `form` is the Host's live configuration form for this entry's namespace. Its
 * snapshot mirrors the profile, and a write through it is what the Host accepts:
 * only whole top-level nodes are editable, because volatility is marked on those
 * and not inside a rule.
 */
export interface CardFace {
  form: ConfigForm<WebFetchAuthConfig>;
  status: () => Promise<RemoteResult<ProviderStatusReport>>;
  testRule: (
    ruleId: string,
    url?: string,
  ) => Promise<RemoteResult<RuleTestReport>>;
  diagnose: (url: string) => Promise<RemoteResult<DiagnoseReport>>;
  credentials: CredentialsRemote;
}

export function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "err";
  children: string;
}): JSX.Element {
  return <span className={`wfa-pill ${tone}`}>{children}</span>;
}

/**
 * One meta line of facts, separated by layout rather than by a glyph.
 *
 * The card used to join every fact with a middle dot; a line of them reads as
 * decoration and costs the reader a token per item (SC 1.4.11 aside, a glyph
 * carries no meaning a gap does not). Items are single spans: each fact keeps
 * its own label and value, and the gap between them does the separating.
 */
export function MetaLine({
  muted,
  children,
}: {
  muted?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={muted === true ? "wfa-meta wfa-muted" : "wfa-meta"}>
      {children}
    </div>
  );
}

/** One fact of a meta line. */
export function Meta({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <span className="wfa-meta-item">
      {label !== undefined && <b>{label}</b>} {children}
    </span>
  );
}

/**
 * A row action. The rule row carries four of them, and spelled out they
 * wrapped the row onto a second line, so each is an icon — but an icon is not
 * a name: the label stays in `aria-label` (screen readers) and `title` (the
 * pointer), and the glyph itself is hidden from the accessibility tree.
 */
export function IconButton({
  label,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      className={danger === true ? "wfa-icon-btn danger" : "wfa-icon-btn"}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 14 14"
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}

/** Enable/disable a rule. */
export const ICON_POWER = (
  <>
    <path d="M7 2.2v4.4" />
    <path d="M4.3 4a4 4 0 1 0 5.4 0" />
  </>
);

/** Run the connection tester. */
export const ICON_TEST = <path d="M4.9 3.3 10.7 7l-5.8 3.7z" />;

/** Edit a rule. */
export const ICON_EDIT = (
  <>
    <path d="m2.5 11.5.7-2.4 6.5-6.5 1.7 1.7-6.5 6.5z" />
    <path d="m9 3.3 1.7 1.7" />
  </>
);

/** Delete a rule. */
export const ICON_DELETE = (
  <>
    <path d="M2.6 4h8.8" />
    <path d="M5.6 4v-.8a.7.7 0 0 1 .7-.7h1.4a.7.7 0 0 1 .7.7V4" />
    <path d="m4.3 4 .5 6.9a.7.7 0 0 0 .7.6h3a.7.7 0 0 0 .7-.6L9.7 4" />
  </>
);

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="wfa-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ToggleRow({
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <div className="wfa-toggle-row">
      <span className="wfa-toggle-copy">
        <strong>{title}</strong>
        <span>{hint}</span>
      </span>
      <input
        className="wfa-toggle"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={title}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    </div>
  );
}
