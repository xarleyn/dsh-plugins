/**
 * The managed service credentials section of the operator card: the deployment
 * profile and the profiles of read-only service accounts it can connect with
 * instead of a guest. A profile list commits as a whole at its parent path, so
 * a row can never be half-stored; the drafts reset from the stored list when
 * the Host accepts or refuels it.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { RecordField } from "../operator-controls.js";
import { draftNote, profileDraftMissing } from "../operator-drafts.js";
import {
  Group,
  PROVIDER_IDS,
  rawArray,
  rawBool,
  rawObject,
  rawRecord,
  rawString,
  resourceRows,
  Section,
  type OperatorForm,
} from "./shared.js";

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

const PROFILE_PATH = ["managedServiceCredentials", "profiles"] as const;

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

/**
 * The managed-credential profile list editor.
 */
function ServiceProfilesField(props: {
  profiles: readonly ProfileDraft[];
  disabled: boolean;
  write: (path: readonly string[], value: unknown) => void;
  unset: (path: readonly string[]) => void;
  overridden: (path: readonly string[]) => boolean;
}): ReactElement {
  const [drafts, setDrafts] = useState<readonly ProfileDraft[]>(props.profiles);
  const storedCount = useRef(props.profiles.length);
  useEffect(() => {
    setDrafts((current) => {
      const accepted = Math.max(0, props.profiles.length - storedCount.current);
      const pending = current.slice(storedCount.current + accepted);
      storedCount.current = props.profiles.length;
      return [...props.profiles, ...pending];
    });
  }, [props.profiles]);
  const commit = (
    next: readonly ProfileDraft[],
    unsetWhenEmpty = next.length === 0,
  ) => {
    setDrafts(next);
    const persisted = next.slice(0, storedCount.current);
    if (persisted.some((row) => profileDraftMissing(row).length > 0)) return;
    const takeable = [
      ...persisted,
      ...next
        .slice(storedCount.current)
        .filter((row) => profileDraftMissing(row).length === 0),
    ];
    if (takeable.length === 0) {
      if (unsetWhenEmpty) {
        props.unset([...PROFILE_PATH]);
      }
      return;
    }
    props.write([...PROFILE_PATH], takeable.map(profileWire));
  };
  const edit = (index: number, patch: Partial<ProfileDraft>) => {
    commit(
      drafts.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
  };
  const commitRecord = (
    index: number,
    key: "resources" | "policy",
    rows: ReadonlyArray<readonly [string, string]>,
  ) => {
    if (rows.length === 0) {
      commit(
        drafts.map((row, at) => (at === index ? { ...row, [key]: [] } : row)),
      );
      return;
    }
    commit(
      drafts.map((row, at) =>
        at === index
          ? {
              ...row,
              [key]: rows,
            }
          : row,
      ),
    );
  };
  return (
    <div className="qai-op__field">
      <span className="qai-op__label">
        Профили доступов
        {props.overridden([...PROFILE_PATH]) ? (
          <span className="qai-op__overridden">переопределено</span>
        ) : null}
      </span>
      <ul className="qai-op__profiles">
        {drafts.map((row, index) => (
          <li
            key={`${index}:${row.id}`}
            className="qai-op__profile"
            data-testid={`qa-integrations-service-access-profile-${index}`}
          >
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
                  const removedStored = index < storedCount.current;
                  if (removedStored) storedCount.current -= 1;
                  commit(
                    drafts.filter((_, at) => at !== index),
                    removedStored,
                  );
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
                    const next = drafts[index]?.id.trim() ?? "";
                    edit(index, { id: next });
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
                    const next = drafts[index]?.instance.trim() ?? "";
                    edit(index, { instance: next });
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
                    const next = drafts[index]?.label.trim() ?? "";
                    edit(index, { label: next });
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
                    const next = drafts[index]?.secretFile.trim() ?? "";
                    edit(index, { secretFile: next });
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
                    const next = drafts[index]?.secretEnv.trim() ?? "";
                    edit(index, { secretEnv: next });
                  }}
                />
              </span>
            </div>
            <RecordField
              label="Ресурсы (вид: значения через запятую)"
              path={[...PROFILE_PATH]}
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
              path={[...PROFILE_PATH]}
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
            {index >= storedCount.current ||
            profileDraftMissing(row).length > 0 ? (
              <span className="qai-op__pending">
                {draftNote(profileDraftMissing(row))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <span>
        <button
          type="button"
          className="qai-op__button"
          data-testid="qa-integrations-service-access-add-profile"
          disabled={props.disabled}
          onClick={() => {
            commit([
              ...drafts,
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

export function ServiceAccessSection({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  const msc = rawObject(form.config.managedServiceCredentials);
  return (
    <Section
      testId="qa-integrations-service-access"
      title="Сервисные доступы"
      hint="общие read-only креденшалы, которыми владеет развёртывание"
    >
      <Group testId="qa-integrations-service-access-mode" title="Режим">
        {form.toggle(
          "Сервисные доступы включены",
          ["managedServiceCredentials", "enabled"],
          rawBool(msc.enabled, false),
        )}
        {form.toggle(
          "Новое подключение стартует в сервисном режиме",
          ["managedServiceCredentials", "defaultForNewConnections"],
          rawBool(msc.defaultForNewConnections, true),
        )}
      </Group>
      <Group
        testId="qa-integrations-service-access-profiles"
        title="Профили доступа"
        wide
        hint="read-only аккаунт, которым развёртывание подключается вместо гостя"
      >
        <ServiceProfilesField
          profiles={profileDrafts(msc.profiles)}
          disabled={form.control.disabled}
          write={form.control.write}
          unset={form.control.unset}
          overridden={form.control.overridden}
        />
      </Group>
    </Section>
  );
}
