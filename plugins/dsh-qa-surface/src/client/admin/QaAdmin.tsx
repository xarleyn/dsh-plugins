import { useEffect, useMemo, useState } from "react";
import type {
  QaAccessAdminSnapshot,
  QaAccessUser,
  QaCapabilityDescriptor,
  QaCapabilitySelection,
  QaSubrole,
  QaUserAccess,
} from "../../types.js";
import type { QaAccessApi } from "../types.js";

type Page = "subroles" | "common" | "users" | "audit";
type CapabilityType = "tool" | "skill";

const AUDIT_LABELS = {
  "subrole.created": "Саброль создана",
  "subrole.updated": "Саброль изменена",
  "subrole.deleted": "Саброль удалена",
  "common.updated": "Общие возможности изменены",
  "assignment.updated": "Назначение изменено",
} as const;

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object" && "message" in error) {
    return String((error as { readonly message?: unknown }).message ?? error);
  }
  return String(error);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function CapabilityPicker(props: {
  readonly type: CapabilityType;
  readonly catalog: readonly QaCapabilityDescriptor[];
  readonly selected: readonly string[];
  readonly inherited?: readonly string[];
  readonly system?: readonly string[];
  readonly onChange?: (next: readonly string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const inherited = new Set(props.inherited ?? []);
  const system = new Set(props.system ?? []);
  const selected = new Set(props.selected);
  const rows = props.catalog.filter(
    ({ type, id, title }) =>
      type === props.type &&
      (!selectedOnly ||
        selected.has(id) ||
        inherited.has(id) ||
        system.has(id)) &&
      (query === "" ||
        `${id} ${title}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())),
  );
  const groups = new Map<string, QaCapabilityDescriptor[]>();
  for (const row of rows) {
    const group =
      row.source.name === undefined
        ? row.source.kind
        : `${row.source.kind} · ${row.source.name}`;
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return (
    <div className="dsh-qa-capabilities">
      <div className="dsh-qa-capabilities__toolbar">
        <input
          type="search"
          value={query}
          placeholder={
            props.type === "tool" ? "Поиск инструментов…" : "Поиск навыков…"
          }
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(event) => setSelectedOnly(event.currentTarget.checked)}
          />
          Только выбранные
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="dsh-qa-admin__empty">Ничего не найдено.</p>
      ) : (
        [...groups].map(([group, entries]) => (
          <section key={group} className="dsh-qa-capabilities__group">
            <h4>{group.toLocaleUpperCase()}</h4>
            {entries.map((capability) => {
              const required = system.has(capability.id);
              const common = inherited.has(capability.id);
              const checked = required || common || selected.has(capability.id);
              return (
                <label
                  key={`${capability.type}:${capability.id}`}
                  className="dsh-qa-capability"
                  title={
                    required
                      ? "Системная возможность"
                      : common
                        ? "Управляется в общих возможностях"
                        : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      required || common || props.onChange === undefined
                    }
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.currentTarget.checked) next.add(capability.id);
                      else next.delete(capability.id);
                      props.onChange?.([...next]);
                    }}
                  />
                  <span className="dsh-qa-capability__copy">
                    <strong>{capability.title}</strong>
                    {capability.description === undefined ? null : (
                      <small>{capability.description}</small>
                    )}
                    {capability.type === "skill" ? (
                      <small>
                        Provider:{" "}
                        {capability.source.name ?? capability.source.kind}
                        {capability.modelInvocable === false
                          ? " · только вручную"
                          : " · доступен модели"}
                      </small>
                    ) : null}
                  </span>
                  {required ? (
                    <em>Системное</em>
                  ) : common ? (
                    <em>Общее</em>
                  ) : null}
                  {capability.status === "missing" ? (
                    <em className="dsh-qa-capability__missing">
                      Не установлен
                    </em>
                  ) : null}
                </label>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}

function emptyRole(): QaSubrole {
  return {
    id: "",
    name: "",
    description: "",
    enabled: true,
    capabilities: { tools: [], skills: [] },
  };
}

function RoleEditor(props: {
  readonly role: QaSubrole | null;
  readonly catalog: readonly QaCapabilityDescriptor[];
  readonly common: QaCapabilitySelection;
  readonly system: QaCapabilitySelection;
  readonly onCancel: () => void;
  readonly onSave: (role: QaSubrole) => Promise<void>;
}) {
  const existing = props.role !== null;
  const [draft, setDraft] = useState<QaSubrole>(props.role ?? emptyRole());
  const [tab, setTab] = useState<"general" | "tools" | "skills" | "effective">(
    "general",
  );
  const [saving, setSaving] = useState(false);
  const setCapabilities = (key: CapabilityType, values: readonly string[]) =>
    setDraft((current) => ({
      ...current,
      capabilities: {
        ...current.capabilities,
        [key === "tool" ? "tools" : "skills"]: values,
      },
    }));
  const effectiveTools = unique([
    ...props.system.tools,
    ...props.common.tools,
    ...draft.capabilities.tools,
  ]);
  const effectiveSkills = unique([
    ...props.system.skills,
    ...props.common.skills,
    ...draft.capabilities.skills,
  ]);
  return (
    <section className="dsh-qa-role-editor">
      <div className="dsh-qa-admin__title-row">
        <div>
          <button
            type="button"
            className="dsh-qa-admin__back"
            onClick={props.onCancel}
          >
            ← Саброли
          </button>
          <h2>{existing ? draft.name : "Новая саброль"}</h2>
          <p>{draft.description || "Профиль возможностей QA-ассистента"}</p>
        </div>
      </div>
      <div className="dsh-qa-admin__tabs">
        {(
          [
            ["general", "Общее"],
            ["tools", "Инструменты"],
            ["skills", "Навыки"],
            ["effective", "Фактический доступ"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "general" ? (
        <div className="dsh-qa-role-editor__general">
          <label>
            Название
            <input
              value={draft.name}
              maxLength={100}
              onChange={(event) =>
                setDraft({ ...draft, name: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Slug / ID
            <input
              value={draft.id}
              disabled={existing}
              pattern="[a-z0-9][a-z0-9-]*"
              onChange={(event) =>
                setDraft({ ...draft, id: event.currentTarget.value })
              }
            />
          </label>
          <label className="dsh-qa-role-editor__wide">
            Описание
            <textarea
              value={draft.description ?? ""}
              maxLength={500}
              onChange={(event) =>
                setDraft({ ...draft, description: event.currentTarget.value })
              }
            />
          </label>
          <label className="dsh-qa-role-editor__check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft({ ...draft, enabled: event.currentTarget.checked })
              }
            />
            Включена
          </label>
        </div>
      ) : tab === "tools" ? (
        <CapabilityPicker
          type="tool"
          catalog={props.catalog}
          inherited={props.common.tools}
          system={props.system.tools}
          selected={draft.capabilities.tools}
          onChange={(values) => setCapabilities("tool", values)}
        />
      ) : tab === "skills" ? (
        <CapabilityPicker
          type="skill"
          catalog={props.catalog}
          inherited={props.common.skills}
          system={props.system.skills}
          selected={draft.capabilities.skills}
          onChange={(values) => setCapabilities("skill", values)}
        />
      ) : (
        <div className="dsh-qa-effective">
          <h3>Фактические возможности для {draft.name || draft.id}</h3>
          <p>
            <strong>{effectiveTools.length}</strong> инструментов ·{" "}
            {props.system.tools.length} системных · {props.common.tools.length}{" "}
            общих · {draft.capabilities.tools.length} роли
          </p>
          <CapabilityPicker
            type="tool"
            catalog={props.catalog}
            inherited={props.common.tools}
            system={props.system.tools}
            selected={draft.capabilities.tools}
          />
          <p>
            <strong>{effectiveSkills.length}</strong> навыков ·{" "}
            {props.system.skills.length} системных ·{" "}
            {props.common.skills.length} общих ·{" "}
            {draft.capabilities.skills.length} роли
          </p>
          <CapabilityPicker
            type="skill"
            catalog={props.catalog}
            inherited={props.common.skills}
            system={props.system.skills}
            selected={draft.capabilities.skills}
          />
        </div>
      )}
      <div className="dsh-qa-admin__savebar">
        <span>Изменения применяются к новым разговорам.</span>
        <button type="button" onClick={props.onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className="dsh-qa-admin__primary"
          disabled={
            saving || draft.id.trim() === "" || draft.name.trim() === ""
          }
          onClick={() => {
            setSaving(true);
            void props.onSave(draft).finally(() => setSaving(false));
          }}
        >
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </section>
  );
}

function UserAssignmentRow(props: {
  readonly user: QaAccessUser;
  readonly roles: readonly QaSubrole[];
  readonly onSave: (access: QaUserAccess) => Promise<void>;
}) {
  const [access, setAccess] = useState(props.user.access);
  const [saving, setSaving] = useState(false);
  return (
    <tr>
      <td>
        <strong>{props.user.displayName}</strong>
        <small>{props.user.email}</small>
      </td>
      <td>{props.user.accessRole}</td>
      <td>
        <select
          value={access.defaultSubrole}
          onChange={(event) =>
            setAccess({ ...access, defaultSubrole: event.currentTarget.value })
          }
        >
          {props.roles
            .filter(({ id }) => access.allowedSubroles.includes(id))
            .map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
        </select>
      </td>
      <td className="dsh-qa-users__roles">
        {props.roles.map((role) => (
          <label key={role.id}>
            <input
              type="checkbox"
              checked={access.allowedSubroles.includes(role.id)}
              onChange={(event) => {
                const allowed = new Set(access.allowedSubroles);
                if (event.currentTarget.checked) allowed.add(role.id);
                else allowed.delete(role.id);
                const values = [...allowed];
                setAccess({
                  allowedSubroles: values,
                  defaultSubrole: values.includes(access.defaultSubrole)
                    ? access.defaultSubrole
                    : (values[0] ?? ""),
                });
              }}
            />
            {role.name}
          </label>
        ))}
      </td>
      <td>
        <button
          type="button"
          disabled={saving || access.allowedSubroles.length === 0}
          onClick={() => {
            setSaving(true);
            void props.onSave(access).finally(() => setSaving(false));
          }}
        >
          {saving ? "…" : "Сохранить"}
        </button>
      </td>
    </tr>
  );
}

export function QaAdmin(props: {
  readonly api: QaAccessApi;
  readonly token: string;
  readonly routePath: string;
  readonly onPreview: (role: QaSubrole) => void;
}) {
  const [snapshot, setSnapshot] = useState<QaAccessAdminSnapshot>();
  const [page, setPage] = useState<Page>("subroles");
  const [editing, setEditing] = useState<QaSubrole | null | undefined>();
  const [commonType, setCommonType] = useState<CapabilityType>("tool");
  const [common, setCommon] = useState<QaCapabilitySelection>({
    tools: [],
    skills: [],
  });
  const [error, setError] = useState<string>();
  const refresh = async () => {
    const result = await props.api.admin(props.token);
    if (!result.ok) {
      setError(errorMessage(result.error));
      return;
    }
    setSnapshot(result.value);
    setCommon(result.value.config.common);
    setError(undefined);
  };
  useEffect(() => {
    void refresh();
  }, [props.api, props.token]);
  const roles = snapshot?.config.subroles ?? [];
  const enabledRoles = useMemo(
    () => roles.filter(({ enabled }) => enabled),
    [roles],
  );
  const mutate = async (
    operation: () => Promise<{
      readonly ok: boolean;
      readonly error?: unknown;
    }>,
  ) => {
    const result = await operation();
    if (!result.ok) {
      setError(errorMessage(result.error));
      return false;
    }
    await refresh();
    return true;
  };
  if (snapshot === undefined) {
    return (
      <main className="dsh-qa-admin" aria-label="Администрирование QA">
        <div className="dsh-qa-admin__loading">{error ?? "Загружаю роли…"}</div>
      </main>
    );
  }
  if (editing !== undefined) {
    return (
      <main className="dsh-qa-admin" aria-label="Редактор саброли">
        <RoleEditor
          role={editing}
          catalog={snapshot.catalog}
          common={snapshot.config.common}
          system={snapshot.systemRequired}
          onCancel={() => setEditing(undefined)}
          onSave={async (role) => {
            const ok = await mutate(() =>
              editing === null
                ? props.api.createSubrole(props.token, role)
                : props.api.updateSubrole(props.token, editing.id, role),
            );
            if (ok) setEditing(undefined);
          }}
        />
        {error === undefined ? null : (
          <div className="dsh-qa-admin__error">{error}</div>
        )}
      </main>
    );
  }
  return (
    <main className="dsh-qa-admin" aria-label="Администрирование QA">
      <header className="dsh-qa-admin__header">
        <div>
          <strong>QA Administration</strong>
          <span>Роли и возможности</span>
        </div>
        <button
          type="button"
          onClick={() => window.history.pushState(null, "", props.routePath)}
        >
          ← В чат
        </button>
      </header>
      <div className="dsh-qa-admin__layout">
        <nav aria-label="Разделы администрирования">
          <strong>Доступ</strong>
          {(
            [
              ["subroles", "Саброли"],
              ["common", "Общие возможности"],
              ["users", "Пользователи"],
              ["audit", "Аудит"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <section className="dsh-qa-admin__content">
          {error === undefined ? null : (
            <div className="dsh-qa-admin__error">{error}</div>
          )}
          {page === "subroles" ? (
            <>
              <div className="dsh-qa-admin__title-row">
                <div>
                  <h1>Саброли</h1>
                  <p>
                    Профили определяют возможности агента, но не
                    административные права пользователя.
                  </p>
                </div>
                <button
                  type="button"
                  className="dsh-qa-admin__primary"
                  onClick={() => setEditing(null)}
                >
                  Создать саброль
                </button>
              </div>
              <div className="dsh-qa-role-grid">
                {roles.map((role) => (
                  <article key={role.id} className="dsh-qa-role-card">
                    <div className="dsh-qa-role-card__head">
                      <span>{role.ui?.icon ?? "◇"}</span>
                      <div>
                        <h2>{role.name}</h2>
                        <code>{role.id}</code>
                      </div>
                      <em>{role.enabled ? "Включена" : "Выключена"}</em>
                    </div>
                    <p>{role.description ?? "Без описания"}</p>
                    <div className="dsh-qa-role-card__counts">
                      <span>{role.capabilities.tools.length} инструментов</span>
                      <span>{role.capabilities.skills.length} навыков</span>
                      <span>
                        +{" "}
                        {snapshot.config.common.tools.length +
                          snapshot.config.common.skills.length}{" "}
                        общих
                      </span>
                    </div>
                    <div className="dsh-qa-role-card__actions">
                      <button
                        type="button"
                        onClick={() => props.onPreview(role)}
                      >
                        Просмотреть
                      </button>
                      <button type="button" onClick={() => setEditing(role)}>
                        Изменить →
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void mutate(() =>
                            props.api.updateSubrole(props.token, role.id, {
                              ...role,
                              enabled: !role.enabled,
                            }),
                          )
                        }
                      >
                        {role.enabled ? "Выключить" : "Включить"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const ids = new Set(roles.map(({ id }) => id));
                          let id = `${role.id}-copy`;
                          let index = 2;
                          while (ids.has(id)) id = `${role.id}-copy-${index++}`;
                          void mutate(() =>
                            props.api.createSubrole(props.token, {
                              ...role,
                              id,
                              name: `${role.name} — копия`,
                            }),
                          );
                        }}
                      >
                        Дублировать
                      </button>
                      <button
                        type="button"
                        className="dsh-qa-admin__danger"
                        disabled={roles.length <= 1}
                        onClick={() => {
                          if (
                            !window.confirm(`Удалить саброль «${role.name}»?`)
                          )
                            return;
                          const replacement =
                            enabledRoles.find(({ id }) => id !== role.id)?.id ??
                            null;
                          void mutate(() =>
                            props.api.deleteSubrole(
                              props.token,
                              role.id,
                              replacement,
                            ),
                          );
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : page === "common" ? (
            <>
              <div className="dsh-qa-admin__title-row">
                <div>
                  <h1>Общие возможности</h1>
                  <p>
                    Выбранные здесь возможности доступны каждой включённой
                    QA-саброли.
                  </p>
                </div>
              </div>
              <div className="dsh-qa-admin__tabs">
                <button
                  type="button"
                  aria-current={commonType === "tool" ? "page" : undefined}
                  onClick={() => setCommonType("tool")}
                >
                  Инструменты
                </button>
                <button
                  type="button"
                  aria-current={commonType === "skill" ? "page" : undefined}
                  onClick={() => setCommonType("skill")}
                >
                  Навыки
                </button>
              </div>
              <CapabilityPicker
                type={commonType}
                catalog={snapshot.catalog}
                selected={commonType === "tool" ? common.tools : common.skills}
                onChange={(values) =>
                  setCommon({
                    ...common,
                    [commonType === "tool" ? "tools" : "skills"]: values,
                  })
                }
              />
              <div className="dsh-qa-admin__impact">
                ⚠ Изменение затронет {enabledRoles.length} сабролей и{" "}
                {snapshot.users.filter(({ disabled }) => !disabled).length}{" "}
                пользователей. Оно применяется только к новым разговорам.
              </div>
              <div className="dsh-qa-admin__savebar">
                <span />
                <button
                  type="button"
                  className="dsh-qa-admin__primary"
                  onClick={() =>
                    void mutate(() =>
                      props.api.updateCommon(props.token, common),
                    )
                  }
                >
                  Сохранить общие возможности
                </button>
              </div>
            </>
          ) : page === "users" ? (
            <>
              <div className="dsh-qa-admin__title-row">
                <div>
                  <h1>Пользователи</h1>
                  <p>
                    Административная роль и возможности агента настраиваются
                    независимо.
                  </p>
                </div>
              </div>
              <div className="dsh-qa-users">
                <table>
                  <thead>
                    <tr>
                      <th>Пользователь</th>
                      <th>Доступ</th>
                      <th>По умолчанию</th>
                      <th>Доступные саброли</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.users.map((user) => (
                      <UserAssignmentRow
                        key={`${user.id}:${snapshot.audit.length}`}
                        user={user}
                        roles={enabledRoles}
                        onSave={async (access) => {
                          await mutate(() =>
                            props.api.updateAssignment(
                              props.token,
                              user.id,
                              access,
                            ),
                          );
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="dsh-qa-admin__title-row">
                <div>
                  <h1>Аудит</h1>
                  <p>Последние изменения конфигурации доступа.</p>
                </div>
              </div>
              <ol className="dsh-qa-audit">
                {[...snapshot.audit].reverse().map((event, index) => (
                  <li key={`${event.timestamp}:${index}`}>
                    <time>
                      {new Date(event.timestamp).toLocaleString("ru-RU")}
                    </time>
                    <strong>{AUDIT_LABELS[event.action]}</strong>
                    <span>{event.targetId ?? "общие возможности"}</span>
                    <code>{event.actorId}</code>
                    <details>
                      <summary>Показать изменение</summary>
                      <pre>
                        {event.before ?? "—"}
                        {"\n→\n"}
                        {event.after ?? "—"}
                      </pre>
                    </details>
                  </li>
                ))}
              </ol>
              {snapshot.audit.length === 0 ? (
                <p className="dsh-qa-admin__empty">Изменений пока нет.</p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
