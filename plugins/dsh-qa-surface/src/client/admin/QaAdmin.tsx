import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QaAccessAdminSnapshot,
  QaAccountRole,
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
import { AdminSkillFiles } from "./pages/SkillFiles.js";
import { AdminExpertMemory } from "./pages/ExpertMemory.js";
import { AdminUserDetail, AdminUsers } from "./pages/Users.js";
import { RoleEditor } from "./RoleEditor.js";
import { CapabilityPicker } from "./CapabilityPicker.js";
import {
  bucketOf,
  emptySelection,
  TOOL_BUCKET_LABELS,
  type CapabilityType,
  type ToolBucket,
} from "./capability-selection.js";

type Page = QaAdminRoute["page"];
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
    | "audit.read"
    | "skills.manage"
    | "memory.read";
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
    page: "skill-files",
    label: "Редактор навыков",
    group: "Доступ",
    permission: "skills.manage",
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
  {
    page: "memory",
    label: "Память экспертов",
    group: "Качество",
    permission: "memory.read",
  },
  { page: "audit", label: "Аудит", group: "Система", permission: "audit.read" },
];

/** Sections that read the console's own surface rather than the policy file. */
const CONSOLE_PAGES = new Set<Page>([
  "overview",
  "users",
  "user",
  "skill-files",
  "conversations",
  "conversation",
  "review",
  "feedback",
  "quality",
  "memory",
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
      permission === "analytics.read" ||
      // A reviewer reads expert memory because that is where a wrong answer
      // starts repeating itself; the `memory.manage` check the Host makes on
      // every write is what keeps the edit away from them.
      permission === "memory.read"
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

/**
 * Whether the console draws the memory-edit controls. `memory.read` opens the
 * list for a reviewer as well; only `memory.manage` — the admin role — writes,
 * and the Host re-checks that on every call.
 */
function canManageMemory(role: QaAccountRole | undefined): boolean {
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
    <section
      className="dsh-qa-skill-detail"
      data-testid="qa-admin-skill-editor"
    >
      <div className="dsh-qa-admin__title-row">
        <div>
          <button
            type="button"
            className="dsh-qa-admin__back"
            data-testid="qa-admin-skill-back"
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
      <div
        className="dsh-qa-skill-detail__grid"
        data-testid="qa-admin-skill-editor-grid"
      >
        <section data-testid="qa-admin-skill-access">
          <h4>Доступ</h4>
          <label
            className="dsh-qa-role-editor__check"
            data-testid="qa-admin-skill-force-common-field"
          >
            <input
              type="checkbox"
              data-testid="qa-admin-skill-force-common"
              checked={forceCommon}
              onChange={(event) => setForceCommon(event.currentTarget.checked)}
            />
            Доступен всем включённым сабролям
          </label>
          <label
            className="dsh-qa-role-editor__check"
            data-testid="qa-admin-skill-disabled-field"
          >
            <input
              type="checkbox"
              data-testid="qa-admin-skill-disabled"
              checked={disabled}
              onChange={(event) => setDisabled(event.currentTarget.checked)}
            />
            Отключён для всех
          </label>
          <ul className="dsh-qa-skill-roles" data-testid="qa-admin-skill-roles">
            {props.roles.map((role) => {
              const grant = props.skill.roles.find(
                ({ roleId }) => roleId === role.id,
              );
              const checked = !disabled && visible.has(role.id);
              return (
                <li key={role.id} data-testid="qa-admin-skill-role">
                  <label>
                    <input
                      type="checkbox"
                      data-testid="qa-admin-skill-role-check"
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
                  {grant?.declared === true ? (
                    <em data-testid="qa-admin-skill-role-declared">
                      Объявлено навыком
                    </em>
                  ) : null}
                  {grant?.addedByAdmin === true ? (
                    <em data-testid="qa-admin-skill-role-added">
                      Добавлено админом
                    </em>
                  ) : null}
                  {grant?.removedByAdmin === true ? (
                    <em data-testid="qa-admin-skill-role-removed">
                      Отозвано админом
                    </em>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {props.skill.descriptor.warnings.length === 0 ? null : (
            <ul
              className="dsh-qa-skill-warnings"
              data-testid="qa-admin-skill-warnings"
            >
              {props.skill.descriptor.warnings.map((warning) => (
                <li key={warning}>⚠ {warning}</li>
              ))}
            </ul>
          )}
        </section>
        <section data-testid="qa-admin-skill-tools-panel">
          <h4>Инструменты навыка</h4>
          {props.skill.tools.length === 0 ? (
            <p
              className="dsh-qa-admin__empty"
              data-testid="qa-admin-skill-tools-empty"
            >
              Навык не требует инструментов.
            </p>
          ) : (
            <ul
              className="dsh-qa-skill-tools"
              data-testid="qa-admin-skill-tools"
            >
              {props.skill.tools.map((tool) => (
                <li key={tool.id} data-testid="qa-admin-skill-tool">
                  <code data-testid="qa-admin-skill-tool-id">{tool.id}</code>
                  <span
                    className="dsh-qa-skill-tools__state"
                    data-testid="qa-admin-skill-tool-state"
                  >
                    {tool.grantableBy.length > 0 ? (
                      <em data-testid="qa-admin-skill-tool-grantable">
                        Доступен: {tool.grantableBy.join(", ")}
                      </em>
                    ) : null}
                    {tool.installed ? null : (
                      <em
                        className="dsh-qa-capability__missing"
                        data-testid="qa-admin-skill-tool-uninstalled"
                      >
                        Нет в реестре
                      </em>
                    )}
                    {tool.blockedFor.length > 0 ? (
                      <em
                        className="dsh-qa-capability__missing"
                        data-testid={
                          tool.grantableBy.length === 0 &&
                          tool.blockedFor.length ===
                            props.skill.visibleTo.length
                            ? "qa-admin-skill-tool-blocked-all"
                            : "qa-admin-skill-tool-blocked-roles"
                        }
                      >
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
      <div
        className="dsh-qa-admin__savebar"
        data-testid="qa-admin-skill-savebar"
      >
        <span>Назначения хранятся отдельно и не изменяют SKILL.md.</span>
        <button
          type="button"
          data-testid="qa-admin-skill-cancel"
          onClick={props.onCancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className="dsh-qa-admin__primary"
          data-testid="qa-admin-skill-save"
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
    <div className="dsh-qa-skills" data-testid="qa-admin-skill-table">
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
            <tr key={skill.name} data-testid="qa-admin-skill-row">
              <td data-testid="qa-admin-skill-name">
                <strong>{skill.name}</strong>
                {skill.overridden ? (
                  <em data-testid="qa-admin-skill-overridden">Изменён</em>
                ) : null}
                {skill.status === "missing" ? (
                  <em
                    className="dsh-qa-capability__missing"
                    data-testid="qa-admin-skill-uninstalled"
                  >
                    Не установлен
                  </em>
                ) : null}
              </td>
              <td data-testid="qa-admin-skill-audience">
                {skill.disabled
                  ? "Отключён"
                  : skill.visibleTo.length === 0
                    ? "Не назначен"
                    : skill.visibleTo.map(name).join(", ")}
              </td>
              <td data-testid="qa-admin-skill-tool-count">
                {skill.descriptor.requiredTools.length}
              </td>
              <td data-testid="qa-admin-skill-health">
                {HEALTH_LABELS[skill.health]}
              </td>
              <td data-testid="qa-admin-skill-source">
                {SOURCE_LABELS[skill.source.kind]}
                {skill.source.name === undefined
                  ? ""
                  : ` · ${skill.source.name}`}
              </td>
              <td>
                <button
                  type="button"
                  data-testid="qa-admin-skill-edit"
                  onClick={() => props.onSelect(skill)}
                >
                  Изменить →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.skills.length === 0 ? (
        <p
          className="dsh-qa-admin__empty"
          data-testid="qa-admin-skill-table-empty"
        >
          Навыки не найдены.
        </p>
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
      <main
        className="dsh-qa-admin"
        data-testid="qa-admin-root"
        aria-label="Администрирование QA"
      >
        <div className="dsh-qa-admin__loading" data-testid="qa-admin-loading">
          {error ?? "Загружаю роли…"}
        </div>
      </main>
    );
  }
  if (editing !== undefined) {
    return (
      <main
        className="dsh-qa-admin"
        data-testid="qa-admin-root"
        aria-label="Редактор саброли"
      >
        <RoleEditor
          role={editing}
          api={props.api}
          token={props.token}
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
          <div className="dsh-qa-admin__error" data-testid="qa-admin-error">
            {error}
          </div>
        )}
      </main>
    );
  }
  if (editingSkill !== undefined) {
    return (
      <main
        className="dsh-qa-admin"
        data-testid="qa-admin-root"
        aria-label="Назначения навыка"
      >
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
          <div className="dsh-qa-admin__error" data-testid="qa-admin-error">
            {error}
          </div>
        )}
      </main>
    );
  }
  return (
    <main
      className="dsh-qa-admin"
      data-testid="qa-admin-root"
      aria-label="Администрирование QA"
    >
      <header className="dsh-qa-admin__header" data-testid="qa-admin-header">
        <div>
          <strong>QA Administration</strong>
          <span>Роли и возможности</span>
        </div>
        <button
          type="button"
          data-testid="qa-admin-back-to-chat"
          onClick={() => window.history.pushState(null, "", props.routePath)}
        >
          ← В чат
        </button>
      </header>
      <div className="dsh-qa-admin__layout">
        <nav data-testid="qa-admin-nav" aria-label="Разделы администрирования">
          {["QA Admin", "Пользователи", "Доступ", "Качество", "Система"].map(
            (group) => {
              const entries = NAV.filter(
                (entry) =>
                  entry.group === group && canOpen(props.role, entry.page),
              );
              if (entries.length === 0) return null;
              return (
                <div
                  key={group}
                  className="dsh-qa-admin__nav-group"
                  data-testid="qa-admin-nav-group"
                >
                  <strong>{group}</strong>
                  {entries.map((entry) => (
                    <button
                      key={entry.page}
                      type="button"
                      data-testid={`qa-admin-nav-${entry.page}`}
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
        <section
          className="dsh-qa-admin__content"
          data-testid="qa-admin-content"
        >
          {error === undefined ? null : (
            <div className="dsh-qa-admin__error" data-testid="qa-admin-error">
              {error}
            </div>
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
                  data-testid="qa-admin-subrole-create"
                  onClick={() => setEditing(null)}
                >
                  Создать саброль
                </button>
              </div>
              <div
                className="dsh-qa-role-grid"
                data-testid="qa-admin-role-grid"
              >
                {roles.map((role) => (
                  <article
                    key={role.id}
                    className="dsh-qa-role-card"
                    data-testid="qa-admin-role-card"
                  >
                    <div className="dsh-qa-role-card__head">
                      <span>{role.ui?.icon ?? "◇"}</span>
                      <div>
                        <h2>{role.name}</h2>
                        <code>{role.id}</code>
                      </div>
                      <em data-testid="qa-admin-role-state">
                        {role.enabled ? "Включена" : "Выключена"}
                      </em>
                    </div>
                    <p>{role.description ?? "Без описания"}</p>
                    <div
                      className="dsh-qa-role-card__counts"
                      data-testid="qa-admin-role-counts"
                    >
                      <span data-testid="qa-admin-role-count-tools">
                        {role.capabilities.tools.always.length} инструментов
                      </span>
                      <span data-testid="qa-admin-role-count-grantable">
                        +{role.capabilities.tools.skillGrantable.length} по
                        навыкам
                      </span>
                      <span data-testid="qa-admin-role-count-denied">
                        {(role.capabilities.tools.deny ?? []).length} запрещено
                      </span>
                      <span data-testid="qa-admin-role-count-skills">
                        {role.capabilities.skills.length} навыков
                      </span>
                      <span data-testid="qa-admin-role-count-common">
                        +{" "}
                        {snapshot.config.common.tools.always.length +
                          snapshot.config.common.tools.skillGrantable.length +
                          snapshot.config.common.skills.length}{" "}
                        общих
                      </span>
                    </div>
                    <div
                      className="dsh-qa-role-card__actions"
                      data-testid="qa-admin-role-actions"
                    >
                      <button
                        type="button"
                        data-testid="qa-admin-role-preview"
                        onClick={() => props.onPreview(role)}
                      >
                        Просмотреть
                      </button>
                      <button
                        type="button"
                        data-testid="qa-admin-role-edit"
                        onClick={() => setEditing(role)}
                      >
                        Изменить →
                      </button>
                      <button
                        type="button"
                        data-testid="qa-admin-role-toggle"
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
                        data-testid="qa-admin-role-duplicate"
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
                        data-testid="qa-admin-role-delete"
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
          ) : adminApi !== undefined && page === "skill-files" ? (
            <AdminSkillFiles api={adminApi} token={props.token} />
          ) : adminApi !== undefined && page === "memory" ? (
            <AdminExpertMemory
              api={adminApi}
              token={props.token}
              canManage={canManageMemory(props.role)}
            />
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
              <div
                className="dsh-qa-admin__tabs"
                data-testid="qa-admin-common-tabs"
              >
                <button
                  type="button"
                  data-testid="qa-admin-common-tab-tool"
                  aria-current={commonType === "tool" ? "page" : undefined}
                  onClick={() => setCommonType("tool")}
                >
                  Инструменты
                </button>
                <button
                  type="button"
                  data-testid="qa-admin-common-tab-skill"
                  aria-current={commonType === "skill" ? "page" : undefined}
                  onClick={() => setCommonType("skill")}
                >
                  Навыки
                </button>
              </div>
              {commonType === "tool" ? (
                <div
                  className="dsh-qa-admin__tabs"
                  data-testid="qa-admin-common-bucket-tabs"
                >
                  <button
                    type="button"
                    data-testid="qa-admin-common-bucket-always"
                    aria-current={
                      commonToolBucket === "always" ? "page" : undefined
                    }
                    onClick={() => setCommonToolBucket("always")}
                  >
                    {TOOL_BUCKET_LABELS.always}
                  </button>
                  <button
                    type="button"
                    data-testid="qa-admin-common-bucket-skill-grantable"
                    aria-current={
                      commonToolBucket === "skillGrantable" ? "page" : undefined
                    }
                    onClick={() => setCommonToolBucket("skillGrantable")}
                  >
                    {TOOL_BUCKET_LABELS.skillGrantable}
                  </button>
                  <button
                    type="button"
                    data-testid="qa-admin-common-bucket-deny"
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
                testId="qa-admin-common-capabilities"
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
              <div
                className="dsh-qa-admin__impact"
                data-testid="qa-admin-common-impact"
              >
                ⚠ Изменение затронет {enabledRoles.length} сабролей и{" "}
                {snapshot.users.filter(({ disabled }) => !disabled).length}{" "}
                пользователей. Оно применяется только к новым разговорам.
              </div>
              <div
                className="dsh-qa-admin__savebar"
                data-testid="qa-admin-common-savebar"
              >
                <span />
                <button
                  type="button"
                  className="dsh-qa-admin__primary"
                  data-testid="qa-admin-common-save"
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
            <p
              className="dsh-qa-admin__empty"
              data-testid="qa-admin-section-unavailable"
            >
              Раздел недоступен.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
