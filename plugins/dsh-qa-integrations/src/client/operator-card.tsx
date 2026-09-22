/**
 * The Integrations operator card.
 *
 * One source meets here: the `qa-integrations` settings namespace, which is
 * the plugin's configuration source on the Host — the card edits it through
 * path-addressed mutations and the running service re-applies on each commit.
 * Every deployment knob the resolvers accept is reachable from this card; the
 * connection store and its key are the exception, because connections and
 * wrapped secrets belong to the boot path and re-open on a Host restart.
 */

import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import {
  CardShell,
  bindSettingsExternalStore,
} from "@yadsh/dsh-plugin-kit/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import type { QaIntegrationsConfig } from "../config.js";
import {
  InstanceListField,
  NumberField,
  RecordField,
  SelectField,
  StringListField,
  TextField,
  Toggle,
  type ControlProps,
} from "./operator-controls.js";

/** The face the slot entry injects into this card. */
export interface OperatorCardFace {
  readonly scope: SettingsScope<QaIntegrationsConfig>;
}

type CardProps = PropsRuntime<"settings.plugin.item"> &
  InjectFace<OperatorCardFace>;

/** Mutation operations as the bound scope declares them. */
type ScopeOps = Parameters<SettingsScope<QaIntegrationsConfig>["mutate"]>[0];

// ---------------------------------------------------------------- raw reading
//
// The namespace stores the raw user layer, so a field a deployment never
// touched reads as absent. Every accessor below narrows that shape in one
// place and answers with the schema's own default where it can.

function rawObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function rawArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function rawString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function rawNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function rawStringList(value: unknown): readonly string[] {
  return rawArray(value).filter(
    (row): row is string => typeof row === "string",
  );
}

function rawRecord(value: unknown): ReadonlyArray<readonly [string, string]> {
  return Object.entries(rawObject(value)).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
}

function rawBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Resource rows as `kind: v1, v2` text pairs for the record editor. */
function resourceRows(
  value: unknown,
): ReadonlyArray<readonly [string, string]> {
  return Object.entries(rawObject(value)).map(([kind, values]) => [
    kind,
    rawArray(values).map(String).join(", "),
  ]);
}

/** `{ kind: ["a", "b"] }` from the editor's `kind: "a, b"` rows. */
function resourceRecord(
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

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Хост отклонил значение.";
}

/** Whether the raw user layer carries the path (an object walk; lists whole). */
function isOverridden(user: unknown, path: readonly string[]): boolean {
  let cursor = user;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) return false;
  }
  return true;
}

/** Top-level keys the user layer overrides; what «reset» clears. */
function overriddenKeys(user: unknown): readonly string[] {
  return Object.keys(rawObject(user));
}

// ------------------------------------------------------------------- sections

function Section(props: {
  title: string;
  hint?: string;
  /**
   * One line of state for the collapsed header — whether the provider is on,
   * how many connections are configured, how much of the surface is open. A
   * closed section that says nothing forces the reader to open all seven.
   */
  state?: string;
  open?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <details className="qai-op__section" open={props.open}>
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
function Group(props: {
  title: string;
  hint?: string;
  /** A capability checklist reads as a list, not as a column of switches. */
  kind?: "checks";
  /** Connection editors own the full width: instance and site rows are wide. */
  wide?: boolean;
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
    <section className={className}>
      <h4 className="qai-op__group-title">{props.title}</h4>
      {props.hint === undefined ? null : (
        <p className="qai-op__group-hint">{props.hint}</p>
      )}
      <div className="qai-op__grid">{props.children}</div>
    </section>
  );
}

/** The tuning knobs of one provider, folded away until someone needs them. */
function LimitsGroup(props: {
  hint?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <details className="qai-op__group qai-op__group--limits">
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
function plural(
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
function providerState(
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

/** Deployment instances, in editor draft shape (the wire shape is the same). */
interface InstanceRow {
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
function deploymentTypeOf(value: string): string {
  const folded = value.trim().toLowerCase();
  return folded === "server" ||
    folded === "data-center" ||
    folded === "datacenter"
    ? "server"
    : "cloud";
}

function instanceRows(value: unknown): readonly InstanceRow[] {
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
const DEPLOYMENT_OPTIONS = [
  { value: "cloud", label: "Cloud" },
  { value: "server", label: "Server / Data Center" },
] as const;

/**
 * One managed service credential profile, in editor draft shape: resources
 * and policy render as record rows and commit back through the same
 * whole-list write as the scalar fields.
 */
interface ProfileDraft {
  readonly id: string;
  readonly provider: string;
  readonly instance: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly secretFile: string;
  readonly secretEnv: string;
  readonly resources: ReadonlyArray<readonly [string, string]>;
  readonly policy: ReadonlyArray<readonly [string, string]>;
}

function profileDrafts(value: unknown): readonly ProfileDraft[] {
  return rawArray(value)
    .map(rawObject)
    .map((row) => {
      const credential = rawObject(row.credential);
      return {
        id: rawString(row.id),
        provider: rawString(row.provider),
        instance: rawString(row.instance),
        label: rawString(row.label),
        enabled: rawBool(row.enabled, true),
        secretFile: rawString(credential.secretFile),
        secretEnv: rawString(credential.secretEnv),
        resources: resourceRows(row.resources),
        policy: rawRecord(row.policy),
      };
    });
}

const PROVIDER_IDS = [
  "bitrix24",
  "confluence",
  "gitlab",
  "teamcity",
  "jira",
  "testit",
  "weblate",
] as const;

function profileWire(draft: ProfileDraft): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    id: draft.id.trim(),
    provider: draft.provider.trim(),
    instance: draft.instance.trim(),
    label: draft.label.trim(),
    enabled: draft.enabled,
  };
  const secretFile = draft.secretFile.trim();
  const secretEnv = draft.secretEnv.trim();
  if (secretFile !== "" || secretEnv !== "") {
    wire.credential = {
      ...(secretFile === "" ? {} : { secretFile }),
      ...(secretEnv === "" ? {} : { secretEnv }),
    };
  }
  if (draft.resources.length > 0) {
    wire.resources = resourceRecord(draft.resources);
  }
  if (draft.policy.length > 0) {
    wire.policy = Object.fromEntries(
      draft.policy.map(([operation]) => [operation, "deny"]),
    );
  }
  return wire;
}

/**
 * The managed-credential profile list. Every field edit commits the whole
 * array at the parent path, so a row can never be half-stored; the drafts
 * reset from the stored list when the Host accepts or refuels it.
 */
function ServiceProfilesField(props: {
  profiles: readonly ProfileDraft[];
  disabled: boolean;
  write: (path: readonly string[], value: unknown) => void;
  unset: (path: readonly string[]) => void;
  overridden: (path: readonly string[]) => boolean;
}): ReactElement {
  const [drafts, setDrafts] = useState<readonly ProfileDraft[]>(props.profiles);
  useEffect(() => {
    setDrafts(props.profiles);
  }, [props.profiles]);
  const commit = (next: readonly ProfileDraft[]) => {
    setDrafts(next);
    if (next.length === 0) {
      props.unset(["managedServiceCredentials", "profiles"]);
      return;
    }
    props.write(
      ["managedServiceCredentials", "profiles"],
      next.map(profileWire),
    );
  };
  const edit = (index: number, patch: Partial<ProfileDraft>) => {
    commit(
      props.profiles.map((row, at) =>
        at === index ? { ...row, ...patch } : row,
      ),
    );
  };
  const commitRecord = (
    index: number,
    key: "resources" | "policy",
    rows: ReadonlyArray<readonly [string, string]>,
  ) => {
    if (rows.length === 0) {
      commit(
        props.profiles.map((row, at) =>
          at === index ? { ...row, [key]: [] } : row,
        ),
      );
      return;
    }
    commit(
      props.profiles.map((row, at) =>
        at === index
          ? {
              ...row,
              [key]:
                key === "resources"
                  ? resourceRecord(rows)
                  : Object.fromEntries(
                      rows.map(([operation]) => [operation, "deny"]),
                    ),
            }
          : row,
      ),
    );
  };
  return (
    <div className="qai-op__field">
      <span className="qai-op__label">
        Профили доступов
        {props.overridden(["managedServiceCredentials", "profiles"]) ? (
          <span className="qai-op__overridden">переопределено</span>
        ) : null}
      </span>
      <ul className="qai-op__profiles">
        {props.profiles.map((row, index) => (
          <li key={`${index}:${row.id}`} className="qai-op__profile">
            <div className="qai-op__profile-head">
              <strong>{row.label || row.id || "новый профиль"}</strong>
              <label className="qai-op__toggle-row qai-op__toggle-row--inline">
                <input
                  className="qai-op__toggle"
                  type="checkbox"
                  checked={row.enabled}
                  disabled={props.disabled}
                  onChange={(event) => {
                    edit(index, { enabled: event.currentTarget.checked });
                  }}
                />
                <span>включён</span>
              </label>
              <button
                type="button"
                className="qai-op__row-remove"
                disabled={props.disabled}
                onClick={() => {
                  commit(props.profiles.filter((_, at) => at !== index));
                }}
              >
                убрать
              </button>
            </div>
            <div className="qai-op__profile-grid">
              <span className="qai-op__instance-cell">
                <span className="qai-op__instance-key">id</span>
                <input
                  className="qai-op__input"
                  type="text"
                  value={row.id}
                  placeholder="qa-gitlab-readonly"
                  disabled={props.disabled}
                  onChange={(event) => {
                    setDrafts(
                      drafts.map((draft, at) =>
                        at === index
                          ? { ...draft, id: event.currentTarget.value }
                          : draft,
                      ),
                    );
                  }}
                  onBlur={() => {
                    const id = row.id.trim();
                    const next = drafts[index]?.id.trim() ?? "";
                    if (next !== "" && next !== id) edit(index, { id: next });
                  }}
                />
              </span>
              <span className="qai-op__instance-cell">
                <span className="qai-op__instance-key">провайдер</span>
                <select
                  className="qai-op__input"
                  value={row.provider}
                  disabled={props.disabled}
                  onChange={(event) => {
                    edit(index, { provider: event.currentTarget.value });
                  }}
                >
                  {PROVIDER_IDS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </span>
              <span className="qai-op__instance-cell">
                <span className="qai-op__instance-key">инстанс</span>
                <input
                  className="qai-op__input"
                  type="text"
                  value={row.instance}
                  placeholder="corp"
                  disabled={props.disabled}
                  onChange={(event) => {
                    setDrafts(
                      drafts.map((draft, at) =>
                        at === index
                          ? { ...draft, instance: event.currentTarget.value }
                          : draft,
                      ),
                    );
                  }}
                  onBlur={() => {
                    const instance = row.instance.trim();
                    const next = drafts[index]?.instance.trim() ?? "";
                    if (next !== "" && next !== instance) {
                      edit(index, { instance: next });
                    }
                  }}
                />
              </span>
              <span className="qai-op__instance-cell">
                <span className="qai-op__instance-key">название</span>
                <input
                  className="qai-op__input"
                  type="text"
                  value={row.label}
                  placeholder="QA GitLab Read-only"
                  disabled={props.disabled}
                  onChange={(event) => {
                    setDrafts(
                      drafts.map((draft, at) =>
                        at === index
                          ? { ...draft, label: event.currentTarget.value }
                          : draft,
                      ),
                    );
                  }}
                  onBlur={() => {
                    const label = row.label.trim();
                    const next = drafts[index]?.label.trim() ?? "";
                    if (next !== "" && next !== label) {
                      edit(index, { label: next });
                    }
                  }}
                />
              </span>
              <span className="qai-op__instance-cell">
                <span className="qai-op__instance-key">файл секрета</span>
                <input
                  className="qai-op__input"
                  type="text"
                  value={row.secretFile}
                  placeholder="/run/secrets/…"
                  disabled={props.disabled}
                  onChange={(event) => {
                    setDrafts(
                      drafts.map((draft, at) =>
                        at === index
                          ? { ...draft, secretFile: event.currentTarget.value }
                          : draft,
                      ),
                    );
                  }}
                  onBlur={() => {
                    const secretFile = row.secretFile.trim();
                    const next = drafts[index]?.secretFile.trim() ?? "";
                    if (next !== "" && next !== secretFile) {
                      edit(index, { secretFile: next });
                    }
                  }}
                />
              </span>
              <span className="qai-op__instance-cell">
                <span className="qai-op__instance-key">переменная секрета</span>
                <input
                  className="qai-op__input"
                  type="text"
                  value={row.secretEnv}
                  placeholder="QA_GITLAB_TOKEN"
                  disabled={props.disabled}
                  onChange={(event) => {
                    setDrafts(
                      drafts.map((draft, at) =>
                        at === index
                          ? { ...draft, secretEnv: event.currentTarget.value }
                          : draft,
                      ),
                    );
                  }}
                  onBlur={() => {
                    const secretEnv = row.secretEnv.trim();
                    const next = drafts[index]?.secretEnv.trim() ?? "";
                    if (next !== "" && next !== secretEnv) {
                      edit(index, { secretEnv: next });
                    }
                  }}
                />
              </span>
            </div>
            <RecordField
              label="Ресурсы (вид: значения через запятую)"
              path={["managedServiceCredentials", "profiles"]}
              entries={row.resources}
              keyPlaceholder="projects"
              valuePlaceholder="group/repo, group/other"
              disabled={props.disabled}
              write={(_path, value) => {
                commitRecord(
                  index,
                  "resources",
                  Object.entries(
                    value as Record<string, readonly string[]>,
                  ).map(([kind, values]) => [kind, values.join(", ")]),
                );
              }}
              unset={() => {
                commitRecord(index, "resources", []);
              }}
              overridden={props.overridden}
            />
            <RecordField
              label="Запрещённые операции"
              hint="каждая запись всегда хранит значение deny"
              path={["managedServiceCredentials", "profiles"]}
              entries={row.policy}
              keyPlaceholder="mergeRequest.create"
              valuePlaceholder=""
              fixedValue="deny"
              disabled={props.disabled}
              write={(_path, value) => {
                commitRecord(
                  index,
                  "policy",
                  Object.keys(value as Record<string, string>).map(
                    (operation) => [operation, "deny"],
                  ),
                );
              }}
              unset={() => {
                commitRecord(index, "policy", []);
              }}
              overridden={props.overridden}
            />
          </li>
        ))}
      </ul>
      <span>
        <button
          type="button"
          className="qai-op__button"
          disabled={props.disabled}
          onClick={() => {
            commit([
              ...props.profiles,
              {
                id: "",
                provider: "gitlab",
                instance: "",
                label: "",
                enabled: true,
                secretFile: "",
                secretEnv: "",
                resources: [],
                policy: [],
              },
            ]);
          }}
        >
          добавить профиль
        </button>
      </span>
    </div>
  );
}

/** One provider's credential-help override: every field optional, every miss keeps the built-in help. */
function CredentialHelpSection(props: {
  provider: string;
  override: Record<string, unknown>;
  disabled: boolean;
  write: (path: readonly string[], value: unknown) => void;
  unset: (path: readonly string[]) => void;
  overridden: (path: readonly string[]) => boolean;
}): ReactElement {
  const base = ["credentialHelp", props.provider] as const;
  const control: ControlProps = {
    disabled: props.disabled,
    write: props.write,
    unset: props.unset,
    overridden: props.overridden,
  };
  return (
    <details className="qai-op__subsection">
      <summary className="qai-op__section-summary">
        <span className="qai-op__section-title">{props.provider}</span>
        {Object.keys(props.override).length === 0 ? (
          <span className="qai-op__hint">встроенная подсказка</span>
        ) : (
          <span className="qai-op__overridden">переопределено</span>
        )}
      </summary>
      <div className="qai-op__section-body">
        <div className="qai-op__grid">
          <Toggle
            label="Подсказка показывается"
            path={[...base, "enabled"]}
            value={rawBool(props.override.enabled, true)}
            disabled={props.disabled}
            write={props.write}
          />
          <TextField
            label="Механизм (kind)"
            path={[...base, "kind"]}
            value={rawString(props.override.kind)}
            {...control}
          />
          <TextField
            label="Название"
            path={[...base, "label"]}
            value={rawString(props.override.label)}
            {...control}
          />
          <TextField
            label="Где получить токен (адрес)"
            path={[...base, "obtainUrl"]}
            value={rawString(props.override.obtainUrl)}
            placeholder="https://wiki.example.corp/tokens"
            {...control}
          />
          <TextField
            label="Где получить токен (подпись)"
            path={[...base, "obtainLabel"]}
            value={rawString(props.override.obtainLabel)}
            {...control}
          />
          <TextField
            label="Документация (адрес)"
            path={[...base, "docsUrl"]}
            value={rawString(props.override.docsUrl)}
            {...control}
          />
          <TextField
            label="Документация (подпись)"
            path={[...base, "docsLabel"]}
            value={rawString(props.override.docsLabel)}
            {...control}
          />
          <TextField
            label="Инструкция"
            path={[...base, "instructions"]}
            value={rawString(props.override.instructions)}
            {...control}
          />
          <TextField
            label="Ключ локализации инструкции"
            path={[...base, "instructionsLocaleKey"]}
            value={rawString(props.override.instructionsLocaleKey)}
            {...control}
          />
          <StringListField
            label="Скоупы"
            path={[...base, "scopes"]}
            values={rawStringList(props.override.scopes)}
            placeholder="read_user"
            {...control}
          />
          <StringListField
            label="Заметки"
            path={[...base, "notes"]}
            values={rawStringList(props.override.notes)}
            placeholder="токен живёт один год"
            {...control}
          />
          <Toggle
            label="Self-hosted"
            path={[...base, "selfHosted"]}
            value={rawBool(props.override.selfHosted, false)}
            disabled={props.disabled}
            write={props.write}
          />
        </div>
      </div>
    </details>
  );
}

// ----------------------------------------------------------------- the card

export function OperatorCard({ scope }: CardProps): ReactElement | null {
  const store = useMemo(() => bindSettingsExternalStore(scope), [scope]);
  const settings = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const config = rawObject(settings.value);
  const writable = settings.status === "ready" && settings.writable;

  const write = useCallback(
    (path: readonly string[], value: unknown) => {
      const ops = [
        { op: "set", path: [...path], value },
      ] as unknown as ScopeOps;
      scope.mutate(ops).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [scope],
  );
  const unset = useCallback(
    (path: readonly string[]) => {
      const ops = [{ op: "unset", path: [...path] }] as unknown as ScopeOps;
      scope.mutate(ops).catch((cause: unknown) => {
        setError(displayError(cause));
      });
    },
    [scope],
  );
  const overridden = useCallback(
    (path: readonly string[]) => isOverridden(settings.user, path),
    [settings.user],
  );
  const keys = overriddenKeys(settings.user);
  const resetAll = useCallback(() => {
    const ops = keys.map((key) => ({
      op: "unset",
      path: [key],
    })) as unknown as ScopeOps;
    scope.mutate(ops).catch((cause: unknown) => {
      setError(displayError(cause));
    });
  }, [keys, scope]);

  if (settings.status === "unavailable") return null;

  const control: ControlProps = {
    disabled: !writable,
    write,
    unset,
    overridden,
  };
  const msc = rawObject(config.managedServiceCredentials);

  /** Capability toggle: reads default on, deny-listed switches default off. */
  const tg = (
    label: string,
    path: readonly string[],
    value: boolean,
    hint?: string,
  ): ReactElement => (
    <Toggle
      label={label}
      hint={hint}
      path={path}
      value={value}
      disabled={!writable}
      write={write}
      overridden={overridden(path)}
    />
  );

  return (
    <CardShell
      title="Интеграции — конфигурация"
      description="Операторские настройки подключений: провайдеры, адреса, возможности и сервисные доступы. Правка применяется к запущенному сервису сразу."
      badge={
        <span className="dsh-plugin-card__badge">
          {keys.length === 0
            ? "по умолчанию"
            : `переопределено: ${keys.length}`}
        </span>
      }
      label={(open) =>
        open
          ? "Свернуть конфигурацию интеграций"
          : "Развернуть конфигурацию интеграций"
      }
      bodyClassName="qai-op__body"
    >
      {settings.status === "loading" ? (
        <p className="qai-op__muted">Загружаем конфигурацию интеграций…</p>
      ) : (
        <>
          {error !== null ? <div className="qai-op__error">{error}</div> : null}
          {!writable ? (
            <p className="qai-op__muted">
              Хост не принимает правки из этого браузера — значения показаны
              только для чтения.
            </p>
          ) : null}
          <div className="qai-op__toolbar">
            <span className="qai-op__hint">
              Слой правок поверх конфигурации профиля: очищенная настройка
              возвращается к значению из yaml.
            </span>
            <button
              type="button"
              className="qai-op__button"
              disabled={!writable || keys.length === 0}
              onClick={resetAll}
            >
              Сбросить переопределения ({keys.length})
            </button>
          </div>

          <Section title="Общие" open>
            <Group title="Плагин">
              {tg(
                "Плагин включён",
                ["enabled"],
                rawBool(config.enabled, false),
                "выключенный плагин не регистрирует инструменты и прячет пользовательские страницы",
              )}
            </Group>
            <Group
              title="Хранилище и ключи"
              wide
              hint="пути читаются хостом при старте: правка действует со следующего рестарта"
            >
              <TextField
                label="Файл хранилища подключений"
                hint="применяется со следующим рестартом хоста"
                path={["dataPath"]}
                value={rawString(config.dataPath)}
                {...control}
              />
              <TextField
                label="Файл мастер-ключа"
                hint="применяется со следующим рестартом хоста"
                path={["masterKeyPath"]}
                value={rawString(config.masterKeyPath)}
                {...control}
              />
              <NumberField
                label="Версия мастер-ключа"
                path={["masterKeyVersion"]}
                value={rawNumber(config.masterKeyVersion)}
                {...control}
              />
            </Group>
            <Group title="Домены подключений">
              <StringListField
                label="Суффиксы порталов Bitrix24"
                hint="хосты, на которые может указывать вебхук; каждый с точки"
                path={["allowedPortalSuffixes"]}
                values={rawStringList(config.allowedPortalSuffixes)}
                placeholder=".bitrix24.example"
                {...control}
              />
            </Group>
            <LimitsGroup hint="потолки ответов провайдеров и срок хранения аудита">
              <NumberField
                label="Таймаут запроса, мс"
                path={["timeoutMs"]}
                value={rawNumber(config.timeoutMs)}
                {...control}
              />
              <NumberField
                label="Потолок ответа провайдера, байт"
                path={["maxResponseBytes"]}
                value={rawNumber(config.maxResponseBytes)}
                {...control}
              />
              <NumberField
                label="Хранение аудита, дней"
                path={["auditRetentionDays"]}
                value={rawNumber(config.auditRetentionDays)}
                {...control}
              />
            </LimitsGroup>
          </Section>

          <Section
            title="Bitrix24"
            state={providerState(rawObject(config.bitrix24), {
              enabled: true,
              capabilities: [
                ["crmRead", true],
                ["crmCommentWrite", false],
                ["chatRead", true],
                ["openlinesRead", true],
                ["userRead", true],
                ["departmentRead", true],
                ["tasksRead", true],
                ["calendarRead", true],
                ["diskRead", true],
              ],
            })}
          >
            <Group title="Провайдер">
              {tg(
                "Провайдер включён",
                ["bitrix24", "enabled"],
                rawBool(rawObject(config.bitrix24).enabled, true),
              )}
            </Group>
            <Group title="Что доступно агенту" kind="checks">
              {tg(
                "CRM: чтение",
                ["bitrix24", "crmRead"],
                rawBool(rawObject(config.bitrix24).crmRead, true),
              )}
              {tg(
                "CRM: комментарий таймлайна (запись)",
                ["bitrix24", "crmCommentWrite"],
                rawBool(rawObject(config.bitrix24).crmCommentWrite, false),
                "единственный инструмент записи; выключен по умолчанию",
              )}
              {tg(
                "Чаты: чтение",
                ["bitrix24", "chatRead"],
                rawBool(rawObject(config.bitrix24).chatRead, true),
              )}
              {tg(
                "Открытые линии: чтение",
                ["bitrix24", "openlinesRead"],
                rawBool(rawObject(config.bitrix24).openlinesRead, true),
              )}
              {tg(
                "Пользователи: чтение",
                ["bitrix24", "userRead"],
                rawBool(rawObject(config.bitrix24).userRead, true),
              )}
              {tg(
                "Структура компании: чтение",
                ["bitrix24", "departmentRead"],
                rawBool(rawObject(config.bitrix24).departmentRead, true),
              )}
              {tg(
                "Задачи: чтение",
                ["bitrix24", "tasksRead"],
                rawBool(rawObject(config.bitrix24).tasksRead, true),
              )}
              {tg(
                "Календарь: чтение",
                ["bitrix24", "calendarRead"],
                rawBool(rawObject(config.bitrix24).calendarRead, true),
              )}
              {tg(
                "Диск: чтение",
                ["bitrix24", "diskRead"],
                rawBool(rawObject(config.bitrix24).diskRead, true),
              )}
            </Group>
          </Section>

          <Section
            title="Confluence"
            state={providerState(rawObject(config.confluence), {
              enabled: true,
              capabilities: [
                ["identityRead", true],
                ["spacesRead", true],
                ["searchRead", true],
                ["contentRead", true],
                ["commentsRead", true],
                ["attachmentsRead", true],
                ["versionsRead", true],
              ],
              counts: [
                {
                  path: "instances",
                  forms: ["сайт", "сайта", "сайтов"] as const,
                },
              ],
            })}
          >
            <Group title="Провайдер">
              {tg(
                "Провайдер включён",
                ["confluence", "enabled"],
                rawBool(rawObject(config.confluence).enabled, true),
              )}
              {tg(
                "Разрешить http",
                ["confluence", "allowInsecureHttp"],
                rawBool(rawObject(config.confluence).allowInsecureHttp, false),
                "только для dev-стенда",
              )}
            </Group>
            <Group title="Подключение" wide>
              <InstanceListField
                label="Сайты Confluence"
                hint="пользователь выбирает сайт из списка и вводит e-mail с токеном"
                path={["confluence", "instances"]}
                instances={instanceRows(rawObject(config.confluence).instances)}
                deployments={DEPLOYMENT_OPTIONS}
                {...control}
              />
              <StringListField
                label="Разрешённые пространства"
                hint="пусто — все пространства, доступные подключённому аккаунту"
                path={["confluence", "allowedSpaces"]}
                values={rawStringList(
                  rawObject(config.confluence).allowedSpaces,
                )}
                placeholder="PROJ"
                {...control}
              />
            </Group>
            <Group title="Что доступно агенту" kind="checks">
              {tg(
                "Профиль: чтение",
                ["confluence", "identityRead"],
                rawBool(rawObject(config.confluence).identityRead, true),
              )}
              {tg(
                "Пространства: чтение",
                ["confluence", "spacesRead"],
                rawBool(rawObject(config.confluence).spacesRead, true),
              )}
              {tg(
                "Поиск: чтение",
                ["confluence", "searchRead"],
                rawBool(rawObject(config.confluence).searchRead, true),
              )}
              {tg(
                "Страницы: чтение",
                ["confluence", "contentRead"],
                rawBool(rawObject(config.confluence).contentRead, true),
              )}
              {tg(
                "Комментарии: чтение",
                ["confluence", "commentsRead"],
                rawBool(rawObject(config.confluence).commentsRead, true),
              )}
              {tg(
                "Вложения: чтение",
                ["confluence", "attachmentsRead"],
                rawBool(rawObject(config.confluence).attachmentsRead, true),
              )}
              {tg(
                "Версии: чтение",
                ["confluence", "versionsRead"],
                rawBool(rawObject(config.confluence).versionsRead, true),
              )}
            </Group>
            <LimitsGroup>
              <NumberField
                label="Тело страницы по умолчанию, знаков"
                path={["confluence", "defaultBodyChars"]}
                value={rawNumber(rawObject(config.confluence).defaultBodyChars)}
                {...control}
              />
              <NumberField
                label="Потолок тела страницы, знаков"
                path={["confluence", "maxBodyChars"]}
                value={rawNumber(rawObject(config.confluence).maxBodyChars)}
                {...control}
              />
              <NumberField
                label="Строк на страницу списка"
                path={["confluence", "maxResults"]}
                value={rawNumber(rawObject(config.confluence).maxResults)}
                {...control}
              />
              <NumberField
                label="Родителей комментариев на вызов"
                path={["confluence", "maxReplyParents"]}
                value={rawNumber(rawObject(config.confluence).maxReplyParents)}
                {...control}
              />
              <NumberField
                label="Повторы при 429/5xx"
                path={["confluence", "retries"]}
                value={rawNumber(rawObject(config.confluence).retries)}
                {...control}
              />
            </LimitsGroup>
          </Section>

          <Section
            title="GitLab"
            state={providerState(rawObject(config.gitlab), {
              enabled: true,
              capabilities: [
                ["identityRead", true],
                ["projectsRead", true],
                ["repositoryRead", true],
                ["searchRead", true],
                ["issuesRead", true],
                ["mergeRequestsRead", true],
                ["ciRead", true],
              ],
              counts: [
                {
                  path: "instances",
                  forms: ["инстанс", "инстанса", "инстансов"] as const,
                },
              ],
            })}
          >
            <Group title="Провайдер">
              {tg(
                "Провайдер включён",
                ["gitlab", "enabled"],
                rawBool(rawObject(config.gitlab).enabled, true),
              )}
              {tg(
                "Разрешить http",
                ["gitlab", "allowInsecureHttp"],
                rawBool(rawObject(config.gitlab).allowInsecureHttp, false),
                "только для dev-стенда",
              )}
            </Group>
            <Group title="Подключение" wide>
              <InstanceListField
                label="Инстансы GitLab"
                hint="пользователь выбирает инстанс из списка, произвольный хост ввести нельзя"
                path={["gitlab", "instances"]}
                instances={instanceRows(rawObject(config.gitlab).instances)}
                {...control}
              />
            </Group>
            <Group title="Что доступно агенту" kind="checks">
              {tg(
                "Профиль: чтение",
                ["gitlab", "identityRead"],
                rawBool(rawObject(config.gitlab).identityRead, true),
              )}
              {tg(
                "Проекты: чтение",
                ["gitlab", "projectsRead"],
                rawBool(rawObject(config.gitlab).projectsRead, true),
              )}
              {tg(
                "Репозиторий: чтение",
                ["gitlab", "repositoryRead"],
                rawBool(rawObject(config.gitlab).repositoryRead, true),
              )}
              {tg(
                "Поиск: чтение",
                ["gitlab", "searchRead"],
                rawBool(rawObject(config.gitlab).searchRead, true),
              )}
              {tg(
                "Задачи: чтение",
                ["gitlab", "issuesRead"],
                rawBool(rawObject(config.gitlab).issuesRead, true),
              )}
              {tg(
                "MR: чтение",
                ["gitlab", "mergeRequestsRead"],
                rawBool(rawObject(config.gitlab).mergeRequestsRead, true),
              )}
              {tg(
                "CI: чтение",
                ["gitlab", "ciRead"],
                rawBool(rawObject(config.gitlab).ciRead, true),
              )}
            </Group>
            <LimitsGroup>
              <NumberField
                label="Потолок файла, байт"
                path={["gitlab", "maxFileBytes"]}
                value={rawNumber(rawObject(config.gitlab).maxFileBytes)}
                {...control}
              />
              <NumberField
                label="Потолок лога задачи CI, байт"
                path={["gitlab", "maxJobLogBytes"]}
                value={rawNumber(rawObject(config.gitlab).maxJobLogBytes)}
                {...control}
              />
              <NumberField
                label="Потолок результатов поиска"
                path={["gitlab", "maxSearchResults"]}
                value={rawNumber(rawObject(config.gitlab).maxSearchResults)}
                {...control}
              />
              <NumberField
                label="Повторы при 429/5xx"
                path={["gitlab", "retries"]}
                value={rawNumber(rawObject(config.gitlab).retries)}
                {...control}
              />
            </LimitsGroup>
          </Section>

          <Section
            title="TeamCity"
            state={providerState(rawObject(config.teamcity), {
              enabled: true,
              capabilities: [
                ["identityRead", true],
                ["projectsRead", true],
                ["buildConfigsRead", true],
                ["buildsRead", true],
                ["failuresRead", true],
                ["logsRead", true],
                ["queueRead", true],
                ["investigationsRead", true],
                ["agentsRead", true],
                ["artifactsRead", true],
              ],
            })}
          >
            <Group title="Провайдер">
              {tg(
                "Провайдер включён",
                ["teamcity", "enabled"],
                rawBool(rawObject(config.teamcity).enabled, true),
              )}
              {tg(
                "Разрешить http",
                ["teamcity", "network", "allowHttp"],
                rawBool(
                  rawObject(rawObject(config.teamcity).network).allowHttp,
                  false,
                ),
                "незащищённые адреса TeamCity",
              )}
            </Group>
            <Group title="Подключение" wide>
              <TextField
                label="Адрес сервера TeamCity"
                hint="один на весь стенд; пользователь вводит только токен"
                placeholder="https://teamcity.example.corp"
                path={["teamcity", "serverUrl"]}
                value={rawString(rawObject(config.teamcity).serverUrl)}
                {...control}
              />
              <SelectField
                label="Режим сетевой политики"
                path={["teamcity", "network", "mode"]}
                value={
                  rawString(
                    rawObject(rawObject(config.teamcity).network).mode,
                  ) || "allowlist"
                }
                options={[
                  {
                    value: "allowlist",
                    label: "allowlist — только перечисленные адреса",
                  },
                  {
                    value: "trusted-private",
                    label:
                      "trusted-private — любой хост, приватные диапазоны разрешены",
                  },
                ]}
                disabled={!writable}
                write={write}
                overridden={overridden}
              />
              <StringListField
                label="Разрешённые хосты"
                hint="точные имена или *.суффикс; опечатка падает при записи"
                path={["teamcity", "network", "allowedHosts"]}
                values={rawStringList(
                  rawObject(rawObject(config.teamcity).network).allowedHosts,
                )}
                placeholder="teamcity.example.corp"
                {...control}
              />
              <StringListField
                label="Разрешённые CIDR"
                hint="только для адресов, записанных цифрами"
                path={["teamcity", "network", "allowedCidrs"]}
                values={rawStringList(
                  rawObject(rawObject(config.teamcity).network).allowedCidrs,
                )}
                placeholder="10.20.0.0/16"
                {...control}
              />
              <StringListField
                label="Разрешённые порты"
                hint="пусто — только порт схемы"
                path={["teamcity", "network", "allowedPorts"]}
                values={rawStringList(
                  rawObject(rawObject(config.teamcity).network).allowedPorts,
                )}
                placeholder="8111"
                {...control}
              />
            </Group>
            <Group title="Что доступно агенту" kind="checks">
              {(
                [
                  ["identityRead", "Профиль: чтение"],
                  ["projectsRead", "Проекты: чтение"],
                  ["buildConfigsRead", "Конфигурации сборок: чтение"],
                  ["buildsRead", "Сборки: чтение"],
                  ["failuresRead", "Провалы: чтение"],
                  ["logsRead", "Логи сборок: чтение"],
                  ["queueRead", "Очередь: чтение"],
                  ["investigationsRead", "Расследования: чтение"],
                  ["agentsRead", "Агенты: чтение"],
                  ["artifactsRead", "Артефакты: чтение"],
                ] as const
              ).map(([key, label]) =>
                tg(
                  label,
                  ["teamcity", key],
                  rawBool(rawObject(config.teamcity)[key], true),
                ),
              )}
            </Group>
            <LimitsGroup>
              <NumberField
                label="Строк в ответе лога"
                path={["teamcity", "maxLogLines"]}
                value={rawNumber(rawObject(config.teamcity).maxLogLines)}
                {...control}
              />
              <NumberField
                label="Скачивать лога, байт"
                path={["teamcity", "maxLogBytes"]}
                value={rawNumber(rawObject(config.teamcity).maxLogBytes)}
                {...control}
              />
              <NumberField
                label="Артефакт по умолчанию, байт"
                path={["teamcity", "defaultArtifactBytes"]}
                value={rawNumber(
                  rawObject(config.teamcity).defaultArtifactBytes,
                )}
                {...control}
              />
              <NumberField
                label="Потолок артефакта, байт"
                path={["teamcity", "maxArtifactBytes"]}
                value={rawNumber(rawObject(config.teamcity).maxArtifactBytes)}
                {...control}
              />
              <NumberField
                label="Таймаут логов и артефактов, мс"
                path={["teamcity", "streamTimeoutMs"]}
                value={rawNumber(rawObject(config.teamcity).streamTimeoutMs)}
                {...control}
              />
              <NumberField
                label="Повторы при 429/5xx"
                path={["teamcity", "retries"]}
                value={rawNumber(rawObject(config.teamcity).retries)}
                {...control}
              />
            </LimitsGroup>
          </Section>

          <Section
            title="Jira"
            state={providerState(rawObject(config.jira), {
              enabled: true,
              capabilities: [
                ["identityRead", true],
                ["issuesRead", true],
                ["commentsRead", true],
                ["attachmentsRead", true],
                ["transitionsRead", true],
                ["projectsRead", true],
                ["fieldsRead", true],
              ],
              counts: [
                { path: "sites", forms: ["сайт", "сайта", "сайтов"] as const },
              ],
            })}
          >
            <Group title="Провайдер">
              {tg(
                "Провайдер включён",
                ["jira", "enabled"],
                rawBool(rawObject(config.jira).enabled, true),
              )}
              {tg(
                "Разрешить http",
                ["jira", "allowInsecureHttp"],
                rawBool(rawObject(config.jira).allowInsecureHttp, false),
                "только для dev-стенда",
              )}
            </Group>
            <Group title="Подключение" wide>
              <InstanceListField
                label="Сайты Jira Cloud"
                hint="пользователь выбирает сайт из списка, произвольный хост ввести нельзя"
                path={["jira", "sites"]}
                instances={instanceRows(rawObject(config.jira).sites)}
                deployments={DEPLOYMENT_OPTIONS}
                {...control}
              />
              <RecordField
                label="Псевдонимы полей"
                hint="имя поля Jira по бизнес-термину"
                path={["jira", "fieldAliases"]}
                entries={rawRecord(rawObject(config.jira).fieldAliases)}
                keyPlaceholder="продукт"
                valuePlaceholder="customfield_10000"
                {...control}
              />
            </Group>
            <Group title="Что доступно агенту" kind="checks">
              {(
                [
                  ["identityRead", "Профиль: чтение"],
                  ["issuesRead", "Задачи: чтение"],
                  ["commentsRead", "Комментарии: чтение"],
                  ["attachmentsRead", "Вложения: чтение"],
                  ["transitionsRead", "Переходы: чтение"],
                  ["projectsRead", "Проекты: чтение"],
                  ["fieldsRead", "Схема полей: чтение"],
                ] as const
              ).map(([key, label]) =>
                tg(
                  label,
                  ["jira", key],
                  rawBool(rawObject(config.jira)[key], true),
                ),
              )}
            </Group>
            <LimitsGroup>
              <NumberField
                label="Строк поиска по умолчанию"
                path={["jira", "defaultSearchLimit"]}
                value={rawNumber(rawObject(config.jira).defaultSearchLimit)}
                {...control}
              />
              <NumberField
                label="Потолок строк поиска"
                path={["jira", "maxSearchLimit"]}
                value={rawNumber(rawObject(config.jira).maxSearchLimit)}
                {...control}
              />
              <NumberField
                label="Потолок страницы комментариев"
                path={["jira", "maxCommentLimit"]}
                value={rawNumber(rawObject(config.jira).maxCommentLimit)}
                {...control}
              />
              <NumberField
                label="Знаков текста в ответе"
                path={["jira", "maxTextChars"]}
                value={rawNumber(rawObject(config.jira).maxTextChars)}
                {...control}
              />
              <NumberField
                label="Повторы при 429/5xx"
                path={["jira", "retries"]}
                value={rawNumber(rawObject(config.jira).retries)}
                {...control}
              />
            </LimitsGroup>
          </Section>

          <Section
            title="Test IT"
            state={providerState(rawObject(config.testit), {
              enabled: true,
              capabilities: [
                ["projectsRead", true],
                ["sectionsRead", true],
                ["workItemsRead", true],
                ["historyRead", true],
                ["commentsRead", true],
                ["testPlansRead", true],
                ["testRunsRead", true],
                ["testResultsRead", true],
                ["autoTestsRead", true],
                ["attachmentsRead", true],
                ["configurationsRead", true],
              ],
              counts: [
                {
                  path: "instances",
                  forms: ["инстанс", "инстанса", "инстансов"] as const,
                },
              ],
            })}
          >
            <Group title="Провайдер">
              {tg(
                "Провайдер включён",
                ["testit", "enabled"],
                rawBool(rawObject(config.testit).enabled, true),
              )}
              {tg(
                "Разрешить http",
                ["testit", "allowInsecureHttp"],
                rawBool(rawObject(config.testit).allowInsecureHttp, false),
                "только для dev-стенда",
              )}
            </Group>
            <Group title="Подключение" wide>
              <InstanceListField
                label="Инсталляции Test IT"
                path={["testit", "instances"]}
                instances={instanceRows(rawObject(config.testit).instances)}
                {...control}
              />
            </Group>
            <Group title="Что доступно агенту" kind="checks">
              {(
                [
                  ["projectsRead", "Проекты: чтение"],
                  ["sectionsRead", "Секции: чтение"],
                  ["workItemsRead", "Work items: чтение"],
                  ["historyRead", "История: чтение"],
                  ["commentsRead", "Комментарии: чтение"],
                  ["testPlansRead", "Планы: чтение"],
                  ["testRunsRead", "Прогоны: чтение"],
                  ["testResultsRead", "Результаты: чтение"],
                  ["autoTestsRead", "Автотесты: чтение"],
                  ["attachmentsRead", "Вложения: чтение"],
                  ["configurationsRead", "Конфигурации: чтение"],
                ] as const
              ).map(([key, label]) =>
                tg(
                  label,
                  ["testit", key],
                  rawBool(rawObject(config.testit)[key], true),
                ),
              )}
            </Group>
            <LimitsGroup>
              <NumberField
                label="Строк по умолчанию"
                path={["testit", "defaultResults"]}
                value={rawNumber(rawObject(config.testit).defaultResults)}
                {...control}
              />
              <NumberField
                label="Потолок строк списка"
                path={["testit", "maxResults"]}
                value={rawNumber(rawObject(config.testit).maxResults)}
                {...control}
              />
              <NumberField
                label="Вложение по умолчанию, байт"
                path={["testit", "defaultAttachmentBytes"]}
                value={rawNumber(
                  rawObject(config.testit).defaultAttachmentBytes,
                )}
                {...control}
              />
              <NumberField
                label="Потолок вложения, байт"
                path={["testit", "maxAttachmentBytes"]}
                value={rawNumber(rawObject(config.testit).maxAttachmentBytes)}
                {...control}
              />
              <NumberField
                label="Таймаут вложения, мс"
                path={["testit", "attachmentTimeoutMs"]}
                value={rawNumber(rawObject(config.testit).attachmentTimeoutMs)}
                {...control}
              />
              <NumberField
                label="Повторы при 429/5xx"
                path={["testit", "retries"]}
                value={rawNumber(rawObject(config.testit).retries)}
                {...control}
              />
            </LimitsGroup>
          </Section>

          <Section
            title="Weblate"
            state={providerState(rawObject(config.weblate), {
              enabled: true,
              capabilities: [
                ["identityRead", true],
                ["projectsRead", true],
                ["componentsRead", true],
                ["translationsRead", true],
                ["unitsRead", true],
                ["checksRead", true],
                ["commentsRead", true],
                ["suggestionsRead", true],
                ["changesRead", true],
                ["statisticsRead", true],
                ["screenshotsRead", true],
              ],
              counts: [
                {
                  path: "instances",
                  forms: ["инстанс", "инстанса", "инстансов"] as const,
                },
              ],
            })}
          >
            <Group title="Провайдер">
              {tg(
                "Провайдер включён",
                ["weblate", "enabled"],
                rawBool(rawObject(config.weblate).enabled, true),
              )}
              {tg(
                "Разрешить http",
                ["weblate", "allowInsecureHttp"],
                rawBool(rawObject(config.weblate).allowInsecureHttp, false),
                "только для dev-стенда",
              )}
            </Group>
            <Group title="Подключение" wide>
              <InstanceListField
                label="Инстансы Weblate"
                path={["weblate", "instances"]}
                instances={instanceRows(rawObject(config.weblate).instances)}
                {...control}
              />
            </Group>
            <Group title="Что доступно агенту" kind="checks">
              {(
                [
                  ["identityRead", "Профиль: чтение"],
                  ["projectsRead", "Проекты: чтение"],
                  ["componentsRead", "Компоненты: чтение"],
                  ["translationsRead", "Переводы: чтение"],
                  ["unitsRead", "Единицы: чтение"],
                  ["checksRead", "Проверки: чтение"],
                  ["commentsRead", "Комментарии: чтение"],
                  ["suggestionsRead", "Предложения: чтение"],
                  ["changesRead", "Изменения: чтение"],
                  ["statisticsRead", "Статистика: чтение"],
                  ["screenshotsRead", "Скриншоты: чтение"],
                ] as const
              ).map(([key, label]) =>
                tg(
                  label,
                  ["weblate", key],
                  rawBool(rawObject(config.weblate)[key], true),
                ),
              )}
            </Group>
            <LimitsGroup>
              <NumberField
                label="Знаков строки в ответе"
                path={["weblate", "maxTextChars"]}
                value={rawNumber(rawObject(config.weblate).maxTextChars)}
                {...control}
              />
              <NumberField
                label="Строк на страницу"
                path={["weblate", "maxPageSize"]}
                value={rawNumber(rawObject(config.weblate).maxPageSize)}
                {...control}
              />
              <NumberField
                label="Повторы при 429/5xx"
                path={["weblate", "retries"]}
                value={rawNumber(rawObject(config.weblate).retries)}
                {...control}
              />
            </LimitsGroup>
          </Section>

          <Section
            title="Сервисные доступы"
            hint="общие read-only креденшалы, которыми владеет развёртывание"
          >
            <Group title="Режим">
              {tg(
                "Сервисные доступы включены",
                ["managedServiceCredentials", "enabled"],
                rawBool(msc.enabled, false),
              )}
              {tg(
                "Новое подключение стартует в сервисном режиме",
                ["managedServiceCredentials", "defaultForNewConnections"],
                rawBool(msc.defaultForNewConnections, true),
              )}
            </Group>
            <Group
              title="Профили доступа"
              wide
              hint="read-only аккаунт, которым развёртывание подключается вместо гостя"
            >
              <ServiceProfilesField
                profiles={profileDrafts(msc.profiles)}
                disabled={!writable}
                write={write}
                unset={unset}
                overridden={overridden}
              />
            </Group>
          </Section>

          <Section
            title="Подсказки получения доступа"
            hint="замена встроенных ссылок провайдеров своими"
          >
            {PROVIDER_IDS.map((provider) => (
              <CredentialHelpSection
                key={provider}
                provider={provider}
                override={rawObject(rawObject(config.credentialHelp)[provider])}
                disabled={!writable}
                write={write}
                unset={unset}
                overridden={overridden}
              />
            ))}
          </Section>
        </>
      )}
    </CardShell>
  );
}
