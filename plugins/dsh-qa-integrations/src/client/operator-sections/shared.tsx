/**
 * The shared vocabulary of the operator card sections: how the raw settings
 * layer is read, how a section, a group and a limits drawer are drawn, and how
 * a collapsed provider line describes itself. The card shell and the controls
 * live beside this file; everything the provider sections repeat lives here
 * once.
 */

import type { ReactElement, ReactNode } from "react";
import type { ControlProps } from "../operator-controls.js";

/** The plumbing one section uses to reach the settings namespace. */
export interface OperatorForm {
  /** The raw user layer of the namespace; absent means the schema default. */
  readonly config: Record<string, unknown>;
  readonly control: ControlProps;
  /** A capability switch: reads default on, deny-listed switches default off. */
  readonly toggle: (
    label: string,
    path: readonly string[],
    value: boolean,
    hint?: string,
  ) => ReactElement;
}

// ---------------------------------------------------------------- raw reading
//
// The namespace stores the raw user layer, so a field a deployment never
// touched reads as absent. Every accessor below narrows that shape in one
// place and answers with the schema's own default where it can.

export function rawObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function rawArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function rawString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function rawNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function rawStringList(value: unknown): readonly string[] {
  return rawArray(value).filter(
    (row): row is string => typeof row === "string",
  );
}

export function rawRecord(
  value: unknown,
): ReadonlyArray<readonly [string, string]> {
  return Object.entries(rawObject(value)).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
}

export function rawBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** The value a dotted path addresses in the raw layer, or undefined. */
export function readPath(source: unknown, path: readonly string[]): unknown {
  let cursor = source;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) return undefined;
  }
  return cursor;
}

/** Resource rows as `kind: v1, v2` text pairs for the record editor. */
export function resourceRows(
  value: unknown,
): ReadonlyArray<readonly [string, string]> {
  return Object.entries(rawObject(value)).map(([kind, values]) => [
    kind,
    rawArray(values).map(String).join(", "),
  ]);
}

/** `{ kind: ["a", "b"] }` from the editor's `kind: "a, b"` rows. */
export function resourceRecord(
  rows: ReadonlyArray<readonly [string, string]>,
): Record<string, readonly string[]> {
  const record: Record<string, readonly string[]> = {};
  for (const [kind, values] of rows) {
    const list = values
      .split(",")
      .map((row) => row.trim())
      .filter((row) => row !== "");
    if (list.length > 0) record[kind] = list;
  }
  return record;
}

export function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Хост отклонил значение.";
}

/** Whether the raw user layer carries the path (an object walk; lists whole). */
export function isOverridden(user: unknown, path: readonly string[]): boolean {
  let cursor = user;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) return false;
  }
  return true;
}

/** Top-level keys the user layer overrides; what «reset» clears. */
export function overriddenKeys(user: unknown): readonly string[] {
  return Object.keys(rawObject(user));
}

// ------------------------------------------------------------------- sections

export function Section(props: {
  title: string;
  hint?: string;
  /**
   * One line of state for the collapsed header — whether the provider is on,
   * how many connections are configured, how much of the surface is open. A
   * closed section that says nothing forces the reader to open all seven.
   */
  state?: string;
  open?: boolean;
  /** The stable hook a test reaches this section by, whatever its caption says. */
  testId?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <details
      className="qai-op__section"
      data-testid={props.testId}
      open={props.open}
    >
      <summary className="qai-op__section-summary">
        <span className="qai-op__section-title">{props.title}</span>
        {props.state === undefined || props.state === "" ? null : (
          <span className="qai-op__section-state">{props.state}</span>
        )}
        {props.hint === undefined ? null : (
          <span className="qai-op__hint">{props.hint}</span>
        )}
      </summary>
      <div className="qai-op__section-body">{props.children}</div>
    </details>
  );
}

/**
 * A labelled block inside one section: switches that describe the provider,
 * the connections it reads through, the surface it opens to the agent, and the
 * tuning knobs folded away at the end. The fields stay the same controls in the
 * same paths — only the headings that say what belongs with what change.
 */
export function Group(props: {
  title: string;
  hint?: string;
  /** A capability checklist reads as a list, not as a column of switches. */
  kind?: "checks";
  /** Connection editors own the full width: instance and site rows are wide. */
  wide?: boolean;
  /** The stable hook a test reaches this group by, whatever its caption says. */
  testId?: string;
  children: ReactNode;
}): ReactElement {
  const className = [
    "qai-op__group",
    props.kind === "checks" ? "qai-op__group--checks" : "",
    props.wide === true ? "qai-op__group--wide" : "",
  ]
    .filter((part) => part !== "")
    .join(" ");
  return (
    <section className={className} data-testid={props.testId}>
      <h4 className="qai-op__group-title">{props.title}</h4>
      {props.hint === undefined ? null : (
        <p className="qai-op__group-hint">{props.hint}</p>
      )}
      <div className="qai-op__grid">{props.children}</div>
    </section>
  );
}

/** The tuning knobs of one provider, folded away until someone needs them. */
export function LimitsGroup(props: {
  hint?: string;
  /** The stable hook a test reaches this drawer by, whatever its caption says. */
  testId?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <details
      className="qai-op__group qai-op__group--limits"
      data-testid={props.testId}
    >
      <summary className="qai-op__group-summary">
        <span className="qai-op__group-title">Ограничения и повторы</span>
        <span className="qai-op__group-hint">
          {props.hint ?? "потолки ответов и повторы при ошибках провайдера"}
        </span>
      </summary>
      <div className="qai-op__grid">{props.children}</div>
    </details>
  );
}

/** `1 инстанс`, `3 инстанса`, `11 инстансов`. */
export function plural(
  count: number,
  forms: readonly [string, string, string],
): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const [one, few, many] = forms;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} ${few}`;
  }
  return `${count} ${many}`;
}

/** One line describing a collapsed provider: on/off, connections, surface. */
export function providerState(
  provider: Record<string, unknown>,
  shape: {
    /** Include the on/off word; false for sections without a provider switch. */
    readonly enabled?: boolean;
    /** Capability keys with the default the card's own toggle uses. */
    readonly capabilities?: readonly (readonly [string, boolean])[];
    /** List-valued connection fields worth counting, with their word forms. */
    readonly counts?: readonly {
      readonly path: string;
      readonly forms: readonly [string, string, string];
    }[];
  } = {},
): string {
  const parts: string[] = [];
  if (shape.enabled === true) {
    parts.push(rawBool(provider.enabled, true) ? "включён" : "выключен");
  }
  for (const entry of shape.counts ?? []) {
    const list = provider[entry.path];
    const size = Array.isArray(list) ? list.length : 0;
    if (size > 0) parts.push(plural(size, entry.forms));
  }
  const capabilities = shape.capabilities ?? [];
  if (capabilities.length > 0) {
    const on = capabilities.filter(([key, fallback]) =>
      rawBool(provider[key], fallback),
    ).length;
    parts.push(`доступно ${on} из ${capabilities.length}`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------- connection rows

/** Deployment instances, in editor draft shape (the wire shape is the same). */
export interface InstanceRow {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly deploymentType?: string | undefined;
}

/**
 * The one spelling the row control offers for a self-hosted product: the Host
 * resolver folds `data-center` and `datacenter` into the same value, so a stored
 * row reads as the value the control can show and writes back canonically.
 */
export function deploymentTypeOf(value: string): string {
  const folded = value.trim().toLowerCase();
  return folded === "server" ||
    folded === "data-center" ||
    folded === "datacenter"
    ? "server"
    : "cloud";
}

export function instanceRows(value: unknown): readonly InstanceRow[] {
  return rawArray(value)
    .map(rawObject)
    .map((row) => ({
      id: rawString(row.id),
      label: rawString(row.label),
      baseUrl: rawString(row.baseUrl),
      // Only a row that names a product carries the key: a provider without
      // the distinction, and a row the operator never declared one for, must
      // keep writing the three cells it always wrote.
      ...(typeof row.deploymentType === "string" &&
      row.deploymentType.trim() !== ""
        ? { deploymentType: deploymentTypeOf(row.deploymentType) }
        : {}),
    }));
}

/**
 * The products a Jira site or a Confluence instance can answer as, with the
 * Host resolver's default (`cloud`) first: an absent value is read as it.
 */
export const DEPLOYMENT_OPTIONS = [
  { value: "cloud", label: "Cloud" },
  { value: "server", label: "Server / Data Center" },
] as const;

/**
 * The providers whose credential help the card can override, in the order the
 * user meets them in the connect form.
 */
export const PROVIDER_IDS = [
  "bitrix24",
  "confluence",
  "gitlab",
  "teamcity",
  "jira",
  "testit",
  "weblate",
] as const;
