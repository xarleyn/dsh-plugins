import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QaAccessAdminSnapshot,
  QaAccountRole,
  QaCapabilityDescriptor,
  QaCapabilitySelection,
  QaCapabilitySourceKind,
  QaSkillAccess,
  QaSkillAssignmentOverride,
  QaSkillHealth,
  QaSubrole,
} from "../../types.js";
import type { QaAccessApi, QaAdminApi } from "../types.js";
import { adminPath, parseAdminRoute, type QaAdminRoute } from "./routes.js";
import { AdminOverview } from "./pages/Overview.js";
import {
  AdminConversation,
  AdminConversations,
} from "./pages/Conversations.js";
import { AdminReviewQueue } from "./pages/Review.js";
import { AdminAudit, AdminFeedback, AdminQuality } from "./pages/Quality.js";
import { AdminUserDetail, AdminUsers } from "./pages/Users.js";

type Page = QaAdminRoute["page"];
type CapabilityType = "tool" | "skill";
/**
 * The three tool classes: visible immediately, reachable through a loaded
 * skill, or withdrawn from the profile whatever grants them.
 */
type ToolBucket = "always" | "skillGrantable" | "deny";

const TOOL_BUCKET_LABELS: Record<ToolBucket, string> = {
  always: "Всегда доступны",
  skillGrantable: "Доступны через навыки",
  deny: "Запрещённые",
};

/**
 * The sections an operator may open, with the permission each one needs. The
 * nav is filtered by the caller's role, but hiding is only a courtesy: the Host
 * re-checks every permission on the call it serves.
 */
const NAV: readonly {
  readonly page: Page;
  readonly label: string;
  readonly group: string;
  readonly permission:
    | "users.read"
    | "roles.read"
    | "conversations.read.all"
    | "reviews.read"
    | "analytics.read"
    | "audit.read";
}[] = [
  {
    page: "overview",
    label: "Обзор",
    group: "QA Admin",
    permission: "conversations.read.all",
  },
  {
    page: "users",
    label: "Пользователи",
    group: "Пользователи",
    permission: "users.read",
  },
  {
    page: "subroles",
    label: "Саброли",
    group: "Доступ",
    permission: "roles.read",
  },
  {
    page: "common",
    label: "Общие возможности",
    group: "Доступ",
    permission: "roles.read",
  },
  {
    page: "skills",
    label: "Навыки",
    group: "Доступ",
    permission: "roles.read",
  },
  {
    page: "conversations",
    label: "Разговоры",
    group: "Качество",
    permission: "conversations.read.all",
  },
  {
    page: "review",
    label: "Очередь разбора",
    group: "Качество",
    permission: "reviews.read",
  },
  {
    page: "feedback",
    label: "Обратная связь",
    group: "Качество",
    permission: "reviews.read",
  },
  {
    page: "quality",
    label: "Аналитика",
    group: "Качество",
    permission: "analytics.read",
  },
  { page: "audit", label: "Аудит", group: "Система", permission: "audit.read" },
];

/** Sections that read the console's own surface rather than the policy file. */
const CONSOLE_PAGES = new Set<Page>([
  "overview",
  "users",
  "user",
  "conversations",
  "conversation",
  "review",
  "feedback",
  "quality",
  "audit",
]);

/** The permission each section needs, for the nav filter. */
const SECTION_PERMISSIONS = new Map(
  NAV.map((entry) => [entry.page, entry.permission]),
);

/** The role's permission set, as the Host defines it (admin sees everything). */
function canOpen(role: QaAccountRole | undefined, page: Page): boolean {
  if (role === undefined) return true;
  const permission = SECTION_PERMISSIONS.get(page);
  if (permission === undefined) return true;
  if (role === "admin") return true;
  if (role === "reviewer") {
    return (
      permission === "conversations.read.all" ||
      permission === "reviews.read" ||
      permission === "analytics.read"
    );
  }
  // A plain user never reaches the console; the Host refuses every
  // administrative call for that role anyway.
  return false;
}

/**
 * Whether the console offers the conversation-delete control. The Host gates
 * the call itself on `conversations.delete`, which only the admin role carries;
 * this decides what to draw, not what is allowed.
 */
function canDeleteConversation(role: QaAccountRole | undefined): boolean {
  return role === undefined || role === "admin";
}

/** Detail routes keep their parent navigation entry current. */
function isCurrentEntry(route: QaAdminRoute, page: Page): boolean {
  if (route.page === page) return true;
  if (route.page === "user") return page === "users";
  if (route.page === "conversation") return page === "conversations";
  return false;
}

const HEALTH_LABELS: Record<QaSkillHealth, string> = {
  healthy: "В порядке",
  degraded: "Ограничен",
  blocked: "Заблокирован",
  unassigned: "Не назначен",
};

const SOURCE_LABELS: Record<QaCapabilitySourceKind, string> = {
  core: "ядро",
  plugin: "плагин",
  mcp: "MCP",
  filesystem: "файл",
  runtime: "runtime",
};

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

function bucketOf(
  selection: QaCapabilitySelection,
  bucket: ToolBucket,
): readonly string[] {
  if (bucket === "deny") return selection.tools.deny ?? [];
  return selection.tools[bucket];
}

function CapabilityPicker(props: {
  readonly type: CapabilityType;
  readonly catalog: readonly QaCapabilityDescriptor[];
  readonly selected: readonly string[];
  readonly inherited?: readonly string[];
  readonly system?: readonly string[];
  readonly skillDetails?: readonly QaSkillAccess[];
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
              const skill = props.skillDetails?.find(
                ({ name }) => name === capability.id,
              );
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
                      <>
                        <small>
                          Provider:{" "}
                          {capability.source.name ?? capability.source.kind}
                          {capability.modelInvocable === false
                            ? " · только вручную"
                            : " · доступен модели"}
                        </small>
                        {skill === undefined ? null : (
                          <small>
                            {skill.descriptor.requiredTools.length === 0
                              ? "Не выдаёт инструменты"
                              : `Выдаёт при активации: ${skill.descriptor.requiredTools.join(", ")}`}
                          </small>
                        )}
                      </>
                    ) : null}
                  </span>
                  {required ? (
                    <em>Системное</em>
                  ) : common ? (
                    <em>Общее</em>
                  ) : capability.type === "skill" &&
                    selected.has(capability.id) ? (
                    <em>Администратор</em>
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

function emptySelection(): QaCapabilitySelection {
  return { tools: { always: [], skillGrantable: [] }, skills: [] };
}

function emptyRole(): QaSubrole {
  return {
    id: "",
    name: "",
    description: "",
    enabled: true,
    capabilities: emptySelection(),
  };
}

/** Tools and skills one role would receive, and where each one comes from. */
function roleEffective(
  props: {
    readonly system: QaCapabilitySelection;
    readonly common: QaCapabilitySelection;
    readonly role: QaCapabilitySelection;
    readonly skills: readonly QaSkillAccess[];
  },
  roleId: string,
) {
  // A denial beats every grant, the pinned system set included: it is the one
  // way an administrator withdraws a tool the deployment hands to everyone.
  const denied = unique([
    ...(props.common.tools.deny ?? []),
    ...(props.role.tools.deny ?? []),
  ]);
  const withheld = new Set(denied);
  const alwaysTools = unique([
    ...props.system.tools.always,
    ...props.common.tools.always,
    ...props.role.tools.always,
  ]).filter((tool) => !withheld.has(tool));
  const grantable = unique([
    ...props.common.tools.skillGrantable,
    ...props.role.tools.skillGrantable,
  ]).filter((tool) => !withheld.has(tool));
  const via = new Map<string, string[]>();
  for (const skill of props.skills) {
    const grant = skill.roles.find(({ roleId: id }) => id === roleId);
    if (grant === undefined || !grant.visible) continue;
    for (const tool of grant.grantableTools) {
      via.set(tool, [...(via.get(tool) ?? []), skill.name]);
    }
  }
  const managed = unique([
    ...props.system.skills,
    ...props.common.skills,
    ...props.role.skills,
  ]);
  const declared = props.skills
    .filter((skill) =>
      skill.roles.some(({ roleId: id, declared }) => id === roleId && declared),
    )
    .map(({ name }) => name);
  return { alwaysTools, grantable, denied, via, managed, declared };
}

function RoleEditor(props: {
  readonly role: QaSubrole | null;
  readonly catalog: readonly QaCapabilityDescriptor[];
  readonly common: QaCapabilitySelection;
  readonly system: QaCapabilitySelection;
  readonly skills: readonly QaSkillAccess[];
  readonly subroles: readonly QaSubrole[];
  readonly onCancel: () => void;
  readonly onSave: (role: QaSubrole) => Promise<void>;
}) {
  const existing = props.role !== null;
  const [draft, setDraft] = useState<QaSubrole>(props.role ?? emptyRole());
  const [tab, setTab] = useState<"general" | "tools" | "skills" | "effective">(
    "general",
  );
  const [saving, setSaving] = useState(false);
  const setSkills = (values: readonly string[]) =>
    setDraft((current) => ({
      ...current,
      capabilities: { ...current.capabilities, skills: values },
    }));
  const setTools = (bucket: ToolBucket, values: readonly string[]) =>
    setDraft((current) => ({
      ...current,
      capabilities: {
        ...current.capabilities,
        tools: { ...current.capabilities.tools, [bucket]: values },
      },
    }));
  const effective = roleEffective(
    {
      system: props.system,
      common: props.common,
      role: draft.capabilities,
      skills: props.skills,
    },
    draft.id,
  );
  const declaredSkills = props.skills.filter(({ name }) =>
    effective.declared.includes(name),
  );
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
        <div className="dsh-qa-tool-buckets">
          <section>
            <h3>{TOOL_BUCKET_LABELS.always}</h3>
            <p>Видны агенту с первого шага разговора.</p>
            <CapabilityPicker
              type="tool"
              catalog={props.catalog}
              inherited={props.common.tools.always}
              system={props.system.tools.always}
              selected={draft.capabilities.tools.always}
              onChange={(values) => setTools("always", values)}
            />
          </section>
          <section>
            <h3>{TOOL_BUCKET_LABELS.skillGrantable}</h3>
            <p>
              Эти инструменты не показываются агенту по умолчанию. Они
              становятся доступны, когда активируется разрешённый навык,
              которому они нужны.
            </p>
            <CapabilityPicker
              type="tool"
              catalog={props.catalog}
              inherited={props.common.tools.skillGrantable}
              system={props.system.tools.skillGrantable}
              selected={draft.capabilities.tools.skillGrantable}
              onChange={(values) => setTools("skillGrantable", values)}
            />
            {effective.via.size === 0 ? null : (
              <div className="dsh-qa-skill-grants">
                <h4>Используют назначенные навыки</h4>
                <ul>
                  {[...effective.via].map(([tool, skills]) => (
                    <li key={tool}>
                      <code>{tool}</code>
                      <span>Доступен через: {skills.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section>
            <h3>{TOOL_BUCKET_LABELS.deny}</h3>
            <p>
              Инструменты, которые снимаются с этой саброли, даже если их выдают
              системный набор стенда, общие возможности или навык. Запрет
              сильнее любой выдачи и сужает набор, доступный делегированным
              экспертам.
            </p>
            <CapabilityPicker
              type="tool"
              catalog={props.catalog}
              selected={draft.capabilities.tools.deny ?? []}
              onChange={(values) => setTools("deny", values)}
            />
          </section>
        </div>
      ) : tab === "skills" ? (
        <div className="dsh-qa-role-skills">
          <p>
            Навык сам объявляет, каким сабролям он доступен. Здесь настраиваются
            общие навыки и назначения, добавленные вручную.
          </p>
          <section>
            <h4>Объявлены навыками</h4>
            {declaredSkills.length === 0 ? (
              <p className="dsh-qa-admin__empty">
                Ни один навык не объявляет эту саброль.
              </p>
            ) : (
              <ul className="dsh-qa-skill-list">
                {declaredSkills.map((skill) => (
                  <li key={skill.name}>
                    <strong>{skill.name}</strong>
                    <span>
                      {skill.descriptor.requiredTools.length === 0
                        ? "Не выдаёт инструменты"
                        : `Выдаёт при активации: ${skill.descriptor.requiredTools.join(", ")}`}
                    </span>
                    <em>Объявлено навыком</em>
                  </li>
                ))}
              </ul>
            )}
            <p className="dsh-qa-role-skills__hint">
              Отозвать объявленный навык можно на странице «Навыки».
            </p>
          </section>
          <section>
            <h4>Общие и ролевые навыки</h4>
            <CapabilityPicker
              type="skill"
              catalog={props.catalog}
              inherited={props.common.skills}
              system={props.system.skills}
              selected={draft.capabilities.skills}
              skillDetails={props.skills}
              onChange={setSkills}
            />
          </section>
        </div>
      ) : (
        <div className="dsh-qa-effective">
          <h3>
            Фактический доступ для {draft.name || draft.id || "новой роли"}
          </h3>
          <section>
            <h4>{TOOL_BUCKET_LABELS.always}</h4>
            {effective.alwaysTools.length === 0 ? (
              <p className="dsh-qa-admin__empty">Нет инструментов.</p>
            ) : (
              <ul className="dsh-qa-effective__list">
                {effective.alwaysTools.map((tool) => (
                  <li key={tool}>
                    <code>{tool}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>{TOOL_BUCKET_LABELS.skillGrantable}</h4>
            {effective.grantable.length === 0 ? (
              <p className="dsh-qa-admin__empty">
                Роль не может выдавать инструменты.
              </p>
            ) : (
              <ul className="dsh-qa-effective__list">
                {effective.grantable.map((tool) => (
                  <li key={tool}>
                    <code>{tool}</code>
                    <span>
                      {effective.via.get(tool) === undefined
                        ? "Сейчас не используется ни одним назначенным навыком"
                        : `Доступен через: ${effective.via.get(tool)?.join(", ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {effective.denied.length === 0 ? null : (
            <section>
              <h4>{TOOL_BUCKET_LABELS.deny}</h4>
              <ul className="dsh-qa-effective__list">
                {effective.denied.map((tool) => (
                  <li key={tool}>
                    <code>{tool}</code>
                    <span>Снят с этой саброли</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h4>Навыки</h4>
            <ul className="dsh-qa-effective__list">
              {[...unique([...effective.managed, ...effective.declared])].map(
                (skill) => (
                  <li key={skill}>
                    <code>{skill}</code>
                    <span>
                      {effective.declared.includes(skill)
                        ? "Назначен навыком"
                        : "Назначен администратором"}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </section>
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

/**
 * One skill's administrator overlay.
 *
 * The declared audience is shown as the starting point and never rewritten:
 * the checkboxes only record the difference, so clearing the row restores what
 * the skill's own SKILL.md says.
 */
function SkillAssignmentEditor(props: {
  readonly skill: QaSkillAccess;
  readonly roles: readonly QaSubrole[];
  readonly onCancel: () => void;
  readonly onSave: (override: QaSkillAssignmentOverride) => Promise<void>;
}) {
  const declared = new Set(
    props.skill.roles
      .filter(({ declared }) => declared)
      .map(({ roleId }) => roleId),
  );
  const [visible, setVisible] = useState<ReadonlySet<string>>(
    () => new Set(props.skill.visibleTo),
  );
  const [forceCommon, setForceCommon] = useState(props.skill.forceCommon);
  const [disabled, setDisabled] = useState(props.skill.disabled);
  const [saving, setSaving] = useState(false);
  const override = (): QaSkillAssignmentOverride => {
    const shown = disabled ? new Set<string>() : new Set(visible);
    const addToSubroles = [...shown].filter((id) => !declared.has(id));
    const removeFromSubroles = [...declared].filter((id) => !shown.has(id));
    return {
      skillName: props.skill.name,
      ...(addToSubroles.length === 0 ? {} : { addToSubroles }),
      ...(removeFromSubroles.length === 0 ? {} : { removeFromSubroles }),
      ...(forceCommon ? { forceCommon: true } : {}),
      ...(disabled ? { disabled: true } : {}),
    };
  };
  return (
    <section className="dsh-qa-skill-detail">
      <div className="dsh-qa-admin__title-row">
        <div>
          <button
            type="button"
            className="dsh-qa-admin__back"
            onClick={props.onCancel}
          >
            ← Навыки
          </button>
          <h2>{props.skill.name}</h2>
          <p>
            {props.skill.description ??
              (props.skill.status === "missing"
                ? "Навык назначен, но не установлен."
                : "Без описания")}
          </p>
        </div>
      </div>
      <div className="dsh-qa-skill-detail__grid">
        <section>
          <h4>Доступ</h4>
          <label className="dsh-qa-role-editor__check">
            <input
              type="checkbox"
              checked={forceCommon}
              onChange={(event) => setForceCommon(event.currentTarget.checked)}
            />
            Доступен всем включённым сабролям
          </label>
          <label className="dsh-qa-role-editor__check">
            <input
              type="checkbox"
              checked={disabled}
              onChange={(event) => setDisabled(event.currentTarget.checked)}
            />
            Отключён для всех
          </label>
          <ul className="dsh-qa-skill-roles">
            {props.roles.map((role) => {
              const grant = props.skill.roles.find(
                ({ roleId }) => roleId === role.id,
              );
              const checked = !disabled && visible.has(role.id);
              return (
                <li key={role.id}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={checked}
                      onChange={(event) => {
                        const next = new Set(visible);
                        if (event.currentTarget.checked) next.add(role.id);
                        else next.delete(role.id);
                        setVisible(next);
                      }}
                    />
                    {role.name}
                  </label>
                  {grant?.declared === true ? <em>Объявлено навыком</em> : null}
                  {grant?.addedByAdmin === true ? (
                    <em>Добавлено админом</em>
                  ) : null}
                  {grant?.removedByAdmin === true ? (
                    <em>Отозвано админом</em>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {props.skill.descriptor.warnings.length === 0 ? null : (
            <ul className="dsh-qa-skill-warnings">
              {props.skill.descriptor.warnings.map((warning) => (
                <li key={warning}>⚠ {warning}</li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4>Инструменты навыка</h4>
          {props.skill.tools.length === 0 ? (
            <p className="dsh-qa-admin__empty">
              Навык не требует инструментов.
            </p>
          ) : (
            <ul className="dsh-qa-skill-tools">
              {props.skill.tools.map((tool) => (
                <li key={tool.id}>
                  <code>{tool.id}</code>
                  <span className="dsh-qa-skill-tools__state">
                    {tool.grantableBy.length > 0 ? (
                      <em>Доступен: {tool.grantableBy.join(", ")}</em>
                    ) : null}
                    {tool.installed ? null : (
                      <em className="dsh-qa-capability__missing">
                        Нет в реестре
                      </em>
                    )}
                    {tool.blockedFor.length > 0 ? (
                      <em className="dsh-qa-capability__missing">
                        {tool.grantableBy.length === 0 &&
                        tool.blockedFor.length === props.skill.visibleTo.length
                          ? "Недоступен ни одной роли"
                          : `Недоступен: ${tool.blockedFor.join(", ")}`}
                      </em>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {props.skill.tools.length > 0 &&
          props.skill.tools.every(
            ({ grantableBy }) => grantableBy.length === 0,
          ) ? (
            <p className="dsh-qa-role-skills__hint">
              Ни один инструмент не входит в списки «Доступны через навыки» ни
              одной роли — отметьте их в общих возможностях или в редакторе
              роли.
            </p>
          ) : null}
          {props.skill.descriptor.requireAll ? (
            <p className="dsh-qa-role-skills__hint">
              Навык строгий: без любого из инструментов он не активируется.
            </p>
          ) : null}
        </section>
      </div>
      <div className="dsh-qa-admin__savebar">
        <span>Назначения хранятся отдельно и не изменяют SKILL.md.</span>
        <button type="button" onClick={props.onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className="dsh-qa-admin__primary"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void props.onSave(override()).finally(() => setSaving(false));
          }}
        >
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </section>
  );
}

function SkillTable(props: {
  readonly skills: readonly QaSkillAccess[];
  readonly roles: readonly QaSubrole[];
  readonly onSelect: (skill: QaSkillAccess) => void;
}) {
  const name = (id: string) =>
    props.roles.find((role) => role.id === id)?.name ?? id;
  return (
    <div className="dsh-qa-skills">
      <table>
        <thead>
          <tr>
            <th>Навык</th>
            <th>Аудитория</th>
            <th>Инструменты</th>
            <th>Состояние</th>
            <th>Источник</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.skills.map((skill) => (
            <tr key={skill.name}>
              <td>
                <strong>{skill.name}</strong>
                {skill.overridden ? <em>Изменён</em> : null}
                {skill.status === "missing" ? (
                  <em className="dsh-qa-capability__missing">Не установлен</em>
                ) : null}
              </td>
              <td>
                {skill.disabled
                  ? "Отключён"
                  : skill.visibleTo.length === 0
                    ? "Не назначен"
                    : skill.visibleTo.map(name).join(", ")}
              </td>
              <td>{skill.descriptor.requiredTools.length}</td>
              <td>{HEALTH_LABELS[skill.health]}</td>
              <td>
                {SOURCE_LABELS[skill.source.kind]}
                {skill.source.name === undefined
                  ? ""
                  : ` · ${skill.source.name}`}
              </td>
              <td>
                <button type="button" onClick={() => props.onSelect(skill)}>
                  Изменить →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.skills.length === 0 ? (
        <p className="dsh-qa-admin__empty">Навыки не найдены.</p>
      ) : null}
    </div>
  );
}

export function QaAdmin(props: {
  /** Capability administration; the access service's own wire surface. */
  readonly api: QaAccessApi;
  /**
   * The console's own surface. A deployment that serves only the chat surface
   * has no accounts, so the console falls back to the role editors.
   */
  readonly adminApi?: QaAdminApi;
  readonly token: string;
  readonly routePath: string;
  /** The signed-in account's role, used only to filter the navigation. */
  readonly role?: QaAccountRole;
  readonly onPreview: (role: QaSubrole) => void;
}) {
  const [snapshot, setSnapshot] = useState<QaAccessAdminSnapshot>();
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [editing, setEditing] = useState<QaSubrole | null | undefined>();
  const [editingSkill, setEditingSkill] = useState<QaSkillAccess>();

  // The console owns its own sub-routes: a review finding is a link people
  // paste, and the browser's back button must walk the sections.
  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const route = parseAdminRoute(pathname, props.routePath);
  const adminApi = props.adminApi;
  // Without the console's surface — a deployment with no accounts — the
  // sections that read conversations and quality records are unavailable; the
  // capability editors stay reachable under their own routes.
  const page: Page =
    adminApi === undefined && CONSOLE_PAGES.has(route.page)
      ? "subroles"
      : route.page;
  const navigate = useCallback(
    (next: QaAdminRoute) => {
      window.history.pushState(
        { qaAdmin: next.page },
        "",
        adminPath(props.routePath, next),
      );
      setPathname(window.location.pathname);
    },
    [props.routePath],
  );
  const [commonType, setCommonType] = useState<CapabilityType>("tool");
  const [commonToolBucket, setCommonToolBucket] =
    useState<ToolBucket>("always");
  const [common, setCommon] = useState<QaCapabilitySelection>(emptySelection());
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
          skills={snapshot.skills}
          subroles={roles}
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
  if (editingSkill !== undefined) {
    return (
      <main className="dsh-qa-admin" aria-label="Назначения навыка">
        <SkillAssignmentEditor
          skill={editingSkill}
          roles={enabledRoles}
          onCancel={() => setEditingSkill(undefined)}
          onSave={async (override) => {
            const ok = await mutate(() =>
              props.api.updateSkillOverride(props.token, override),
            );
            if (ok) setEditingSkill(undefined);
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
          {["QA Admin", "Пользователи", "Доступ", "Качество", "Система"].map(
            (group) => {
              const entries = NAV.filter(
                (entry) =>
                  entry.group === group && canOpen(props.role, entry.page),
              );
              if (entries.length === 0) return null;
              return (
                <div key={group} className="dsh-qa-admin__nav-group">
                  <strong>{group}</strong>
                  {entries.map((entry) => (
                    <button
                      key={entry.page}
                      type="button"
                      aria-current={
                        isCurrentEntry(route, entry.page) ? "page" : undefined
                      }
                      onClick={() =>
                        navigate({
                          page: entry.page,
                        } as QaAdminRoute)
                      }
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              );
            },
          )}
        </nav>
        <section className="dsh-qa-admin__content">
          {error === undefined ? null : (
            <div className="dsh-qa-admin__error">{error}</div>
          )}
          {adminApi !== undefined && page === "overview" ? (
            <AdminOverview
              api={adminApi}
              token={props.token}
              onOpenConversation={(conversationId, messageId) =>
                navigate({
                  page: "conversation",
                  conversationId,
                  ...(messageId === undefined ? {} : { messageId }),
                })
              }
              onOpenQueue={() => navigate({ page: "review" })}
            />
          ) : adminApi !== undefined && page === "users" ? (
            <AdminUsers
              api={adminApi}
              token={props.token}
              onOpenUser={(userId) => navigate({ page: "user", userId })}
            />
          ) : adminApi !== undefined && page === "user" ? (
            <AdminUserDetail
              api={adminApi}
              accessApi={props.api}
              token={props.token}
              userId={route.page === "user" ? route.userId : ""}
              onBack={() => navigate({ page: "users" })}
              onOpenAudit={() => navigate({ page: "audit" })}
              onOpenConversations={(userId) =>
                navigate({ page: "conversations", userId } as QaAdminRoute)
              }
            />
          ) : adminApi !== undefined && page === "conversations" ? (
            <AdminConversations
              api={adminApi}
              token={props.token}
              onOpenConversation={(conversationId, messageId) =>
                navigate({
                  page: "conversation",
                  conversationId,
                  ...(messageId === undefined ? {} : { messageId }),
                })
              }
            />
          ) : adminApi !== undefined && page === "conversation" ? (
            <AdminConversation
              api={adminApi}
              token={props.token}
              conversationId={
                route.page === "conversation" ? route.conversationId : ""
              }
              {...(route.page === "conversation" &&
              route.messageId !== undefined
                ? { messageId: route.messageId }
                : {})}
              canReview={canOpen(props.role, "review")}
              canDelete={canDeleteConversation(props.role)}
              onBack={() => navigate({ page: "conversations" })}
              onDeleted={() => navigate({ page: "conversations" })}
            />
          ) : adminApi !== undefined && page === "review" ? (
            <AdminReviewQueue
              api={adminApi}
              token={props.token}
              onOpenConversation={(conversationId, messageId) =>
                navigate({
                  page: "conversation",
                  conversationId,
                  ...(messageId === undefined ? {} : { messageId }),
                })
              }
            />
          ) : adminApi !== undefined && page === "feedback" ? (
            <AdminFeedback
              api={adminApi}
              token={props.token}
              onOpenConversation={(conversationId, messageId) =>
                navigate({
                  page: "conversation",
                  conversationId,
                  ...(messageId === undefined ? {} : { messageId }),
                })
              }
            />
          ) : adminApi !== undefined && page === "quality" ? (
            <AdminQuality api={adminApi} token={props.token} />
          ) : adminApi !== undefined && page === "audit" ? (
            <AdminAudit api={adminApi} token={props.token} />
          ) : page === "subroles" ? (
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
                      <span>
                        {role.capabilities.tools.always.length} инструментов
                      </span>
                      <span>
                        +{role.capabilities.tools.skillGrantable.length} по
                        навыкам
                      </span>
                      <span>
                        {(role.capabilities.tools.deny ?? []).length} запрещено
                      </span>
                      <span>{role.capabilities.skills.length} навыков</span>
                      <span>
                        +{" "}
                        {snapshot.config.common.tools.always.length +
                          snapshot.config.common.tools.skillGrantable.length +
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
          ) : page === "skills" ? (
            <>
              <div className="dsh-qa-admin__title-row">
                <div>
                  <h1>Навыки</h1>
                  <p>
                    SKILL.md сам объявляет свою аудиторию и необходимые
                    инструменты. Администратор может расширить или отозвать
                    доступ, не изменяя файл навыка.
                  </p>
                </div>
              </div>
              <SkillTable
                skills={snapshot.skills}
                roles={enabledRoles}
                onSelect={setEditingSkill}
              />
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
              {commonType === "tool" ? (
                <div className="dsh-qa-admin__tabs">
                  <button
                    type="button"
                    aria-current={
                      commonToolBucket === "always" ? "page" : undefined
                    }
                    onClick={() => setCommonToolBucket("always")}
                  >
                    {TOOL_BUCKET_LABELS.always}
                  </button>
                  <button
                    type="button"
                    aria-current={
                      commonToolBucket === "skillGrantable" ? "page" : undefined
                    }
                    onClick={() => setCommonToolBucket("skillGrantable")}
                  >
                    {TOOL_BUCKET_LABELS.skillGrantable}
                  </button>
                  <button
                    type="button"
                    aria-current={
                      commonToolBucket === "deny" ? "page" : undefined
                    }
                    onClick={() => setCommonToolBucket("deny")}
                  >
                    {TOOL_BUCKET_LABELS.deny}
                  </button>
                </div>
              ) : null}
              <CapabilityPicker
                type={commonType}
                catalog={snapshot.catalog}
                skillDetails={snapshot.skills}
                selected={
                  commonType === "tool"
                    ? bucketOf(common, commonToolBucket)
                    : common.skills
                }
                onChange={(values) =>
                  setCommon(
                    commonType === "tool"
                      ? {
                          ...common,
                          tools: {
                            ...common.tools,
                            [commonToolBucket]: values,
                          },
                        }
                      : { ...common, skills: values },
                  )
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
          ) : (
            <p className="dsh-qa-admin__empty">Раздел недоступен.</p>
          )}
        </section>
      </div>
    </main>
  );
}
