import { useCallback, useEffect, useState } from "react";
import type {
  QaAccountRole,
  QaAdminUserRow,
  QaPasswordResetRequest,
  QaUserAccess,
} from "../../../types.js";
import type { QaAdminApi, QaAccessApi } from "../../types.js";
import { ADMIN_ROLE_LABELS, formatCount, formatStamp } from "../copy.js";
import {
  Badge,
  FilterField,
  Pager,
  Stamp,
  adminErrorMessage,
  useAdminResource,
} from "../shared.js";

const PAGE_SIZE = 25;

/** The Host's floor; the form refuses a shorter password before the round trip. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * The forgotten-password queue: an account asked for a reset from the sign-in
 * screen and nobody has answered it yet.
 *
 * It renders only while somebody is waiting. A permanently empty panel would
 * teach operators to ignore it, and this one has to be noticed: answering a row
 * signs every session of that account out, so the new password must be handed
 * over deliberately.
 */
function PasswordResetQueue(props: {
  readonly api: QaAdminApi;
  readonly token: string;
}) {
  const { api, token } = props;
  const [requests, setRequests] = useState<readonly QaPasswordResetRequest[]>(
    [],
  );
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async (): Promise<void> => {
    const result = await api.passwordResetRequests(token);
    if (!result.ok) {
      setError(adminErrorMessage(result.error));
      return;
    }
    setError(undefined);
    setRequests(result.value);
  }, [api, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = async (userId: string): Promise<void> => {
    const password = (drafts[userId] ?? "").trim();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setNotice(undefined);
      setError(`Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов.`);
      return;
    }
    setBusy(userId);
    const result = await api.resetPassword(token, userId, password);
    setBusy(undefined);
    if (!result.ok) {
      setNotice(undefined);
      setError(adminErrorMessage(result.error));
      return;
    }
    setError(undefined);
    setNotice(
      `Новый пароль для ${result.value.user.email} установлен — передайте его пользователю. Заявка закрыта, его сессии завершены.`,
    );
    // The row is gone on the Host's side; the read is what proves it, and it
    // also picks up a request that arrived while this one was being answered.
    setDrafts((current) => ({ ...current, [userId]: "" }));
    await load();
  };

  if (requests.length === 0) return null;
  return (
    <div className="dsh-qa-admin__panel">
      <div className="dsh-qa-admin__panel-head">
        <h2>Заявки на сброс пароля</h2>
        <Badge tone="warning">
          {requests.length === 1
            ? "1 заявка"
            : `${String(requests.length)} заявок`}
        </Badge>
      </div>
      <p className="dsh-qa-admin__panel-note">
        Пользователь не может войти и просит новый пароль. Сброс завершает все
        его сессии: старый пароль и выданные токены перестают действовать.
      </p>
      {error === undefined ? null : (
        <p className="dsh-qa-admin__error" role="alert">
          {error}
        </p>
      )}
      {notice === undefined ? null : (
        <p className="dsh-qa-admin__notice" role="status">
          {notice}
        </p>
      )}
      <table className="dsh-qa-admin__table">
        <thead>
          <tr>
            <th>Пользователь</th>
            <th>Запрошен</th>
            <th>Заявок</th>
            <th>Новый пароль</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.userId}>
              <td>
                <strong>{request.displayName}</strong>
                <small>{request.email}</small>
                {request.disabled ? (
                  <small>
                    <Badge tone="negative">Отключён</Badge>
                  </small>
                ) : null}
              </td>
              <td>
                <Stamp value={request.lastRequestedAt} />
                <small>первый запрос: {formatStamp(request.requestedAt)}</small>
              </td>
              <td>{formatCount(request.requestCount)}</td>
              <td>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  placeholder="не короче 8 символов"
                  disabled={busy === request.userId}
                  value={drafts[request.userId] ?? ""}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDrafts((current) => ({
                      ...current,
                      [request.userId]: value,
                    }));
                  }}
                />
              </td>
              <td>
                <button
                  type="button"
                  disabled={busy === request.userId}
                  onClick={() => void reset(request.userId)}
                >
                  {busy === request.userId ? "Сбрасываю…" : "Сбросить"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Users: the table an administrator triages from, and the detail page that
 * separates authorization from the QA subrole assignment — an admin may work
 * as an analyst without that saying anything about their administrative reach.
 */

export function AdminUsers(props: {
  readonly api: QaAdminApi;
  readonly token: string;
  readonly onOpenUser: (userId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<QaAccountRole | "">("");
  const [status, setStatus] = useState<"active" | "disabled" | "">("");
  const [rows, setRows] = useState<readonly QaAdminUserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  // One loader owns the page: the filter state rebuilds the callback, which
  // restarts paging from the first page, and "show more" continues from the
  // cursor the Host returned.
  const load = useCallback(
    async (next: string | null, append: boolean) => {
      setLoading(true);
      const result = await props.api.users(
        props.token,
        {
          search: search === "" ? null : search,
          role: role === "" ? null : role,
          status: status === "" ? null : status,
        },
        next,
        PAGE_SIZE,
      );
      setLoading(false);
      if (!result.ok) {
        setError(adminErrorMessage(result.error));
        return;
      }
      setError(undefined);
      setTotal(result.value.total);
      setCursor(result.value.nextCursor);
      setRows((current) =>
        append ? [...current, ...result.value.items] : result.value.items,
      );
    },
    [props.api, props.token, search, role, status],
  );

  useEffect(() => {
    void load(null, false);
  }, [load]);

  return (
    <section className="dsh-qa-admin__page" aria-label="Пользователи">
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Пользователи</h1>
          <p>
            Административная роль и профили агента настраиваются независимо.
            Удаления нет: историю разговоров сохраняет отключение.
          </p>
        </div>
      </div>
      <PasswordResetQueue api={props.api} token={props.token} />
      <div className="dsh-qa-admin__filters">
        <FilterField label="Поиск">
          <input
            type="search"
            value={search}
            placeholder="Имя или адрес"
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </FilterField>
        <FilterField label="Роль">
          <select
            value={role}
            onChange={(event) =>
              setRole(event.currentTarget.value as QaAccountRole | "")
            }
          >
            <option value="">Любая</option>
            <option value="admin">Администратор</option>
            <option value="reviewer">Ревьюер</option>
            <option value="user">Пользователь</option>
          </select>
        </FilterField>
        <FilterField label="Статус">
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.currentTarget.value as "active" | "disabled" | "")
            }
          >
            <option value="">Любой</option>
            <option value="active">Активные</option>
            <option value="disabled">Отключённые</option>
          </select>
        </FilterField>
      </div>
      {error === undefined ? null : (
        <p className="dsh-qa-admin__error" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="dsh-qa-admin__empty">
          {loading ? "Загружаю…" : "Никого не нашлось."}
        </p>
      ) : (
        <table className="dsh-qa-admin__table">
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Статус</th>
              <th>Роль</th>
              <th>Профили QA</th>
              <th>Последний вход</th>
              <th>Разговоры</th>
              <th>Оценки</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>
                    {row.fullName === "" ? row.displayName : row.fullName}
                  </strong>
                  <small>{row.email}</small>
                </td>
                <td>
                  {row.disabled ? (
                    <Badge tone="negative">Отключён</Badge>
                  ) : (
                    <Badge tone="positive">Активен</Badge>
                  )}
                </td>
                <td>{ADMIN_ROLE_LABELS[row.role]}</td>
                <td>{row.access.allowedSubroles.join(", ") || "—"}</td>
                <td>
                  <Stamp value={row.lastLoginAt ?? undefined} />
                </td>
                <td>{formatCount(row.conversations)}</td>
                <td>{formatCount(row.feedbackGiven)}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => props.onOpenUser(row.id)}
                  >
                    Открыть
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager
        total={total}
        shown={rows.length}
        hasMore={cursor !== null}
        loading={loading}
        onMore={() => void load(cursor, true)}
        onReset={() => void load(null, false)}
      />
    </section>
  );
}

/** Authorization, assignment and the activity counters of one account. */
export function AdminUserDetail(props: {
  readonly api: QaAdminApi;
  readonly accessApi: QaAccessApi;
  readonly token: string;
  readonly userId: string;
  readonly onBack: () => void;
  readonly onOpenAudit: () => void;
  readonly onOpenConversations: (userId: string) => void;
}) {
  const resource = useAdminResource(
    () => props.api.user(props.token, props.userId),
    [props.api, props.token, props.userId],
  );
  const roles = useAdminResource(
    () => props.accessApi.admin(props.token),
    [props.accessApi, props.token],
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const detail = resource.data;
  const subroles = (roles.data?.config.subroles ?? []).filter(
    ({ enabled }) => enabled,
  );

  const write = async (
    update: Parameters<QaAdminApi["updateUser"]>[2],
  ): Promise<void> => {
    setBusy(true);
    const result = await props.api.updateUser(
      props.token,
      props.userId,
      update,
    );
    setBusy(false);
    if (!result.ok) {
      setError(adminErrorMessage(result.error));
      return;
    }
    // The update response is the fresh detail: applying it directly both
    // confirms the edit on the next render and skips a second heavy read —
    // a reload here used to re-ask for everything the card has just paid for.
    setError(undefined);
    resource.apply(result.value);
  };

  if (resource.error !== undefined) {
    return (
      <section className="dsh-qa-admin__page">
        <p className="dsh-qa-admin__error" role="alert">
          {adminErrorMessage(resource.error)}
        </p>
        <button type="button" onClick={props.onBack}>
          К списку
        </button>
      </section>
    );
  }
  if (detail === undefined) {
    return (
      <section className="dsh-qa-admin__page">
        <p className="dsh-qa-admin__empty">Загружаю пользователя…</p>
      </section>
    );
  }

  const access: QaUserAccess = detail.user.access;
  const toggleSubrole = (id: string): void => {
    const allowed = access.allowedSubroles.includes(id)
      ? access.allowedSubroles.filter((value) => value !== id)
      : [...access.allowedSubroles, id];
    if (allowed.length === 0) {
      setError("Нужен хотя бы один доступный профиль QA.");
      return;
    }
    const defaultSubrole = allowed.includes(access.defaultSubrole)
      ? access.defaultSubrole
      : (allowed[0] as string);
    void write({ access: { allowedSubroles: allowed, defaultSubrole } });
  };

  return (
    <section className="dsh-qa-admin__page" aria-label="Пользователь">
      <div className="dsh-qa-admin__title-row">
        <div>
          <button type="button" onClick={props.onBack}>
            ← Пользователи
          </button>
          <h1>
            {detail.user.fullName === ""
              ? detail.user.displayName
              : detail.user.fullName}
          </h1>
          <p>
            {detail.user.email} · создан {formatStamp(detail.user.createdAt)} ·
            вход {formatStamp(detail.user.lastLoginAt ?? undefined)}
          </p>
        </div>
      </div>
      {error === undefined ? null : (
        <p className="dsh-qa-admin__error" role="alert">
          {error}
        </p>
      )}
      <div className="dsh-qa-admin__columns">
        <section className="dsh-qa-admin__panel">
          <h2>Доступ</h2>
          <FilterField label="Административная роль">
            <select
              value={detail.user.role}
              disabled={busy}
              onChange={(event) =>
                void write({
                  role: event.currentTarget.value as QaAccountRole,
                })
              }
            >
              <option value="user">Пользователь</option>
              <option value="reviewer">Ревьюер</option>
              <option value="admin">Администратор</option>
            </select>
          </FilterField>
          <FilterField label="Статус">
            <button
              type="button"
              disabled={busy}
              onClick={() => void write({ disabled: !detail.user.disabled })}
            >
              {detail.user.disabled ? "Включить" : "Отключить"}
            </button>
          </FilterField>
          <h3>Доступные профили QA</h3>
          <ul className="dsh-qa-admin__checks">
            {subroles.map((role) => (
              <li key={role.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={access.allowedSubroles.includes(role.id)}
                    disabled={busy}
                    onChange={() => toggleSubrole(role.id)}
                  />
                  {role.name}
                </label>
              </li>
            ))}
          </ul>
          <FilterField label="Профиль по умолчанию">
            <select
              value={access.defaultSubrole}
              disabled={busy || access.allowedSubroles.length === 0}
              onChange={(event) =>
                void write({
                  access: {
                    allowedSubroles: access.allowedSubroles,
                    defaultSubrole: event.currentTarget.value,
                  },
                })
              }
            >
              {access.allowedSubroles.map((id) => (
                <option key={id} value={id}>
                  {subroles.find((role) => role.id === id)?.name ?? id}
                </option>
              ))}
            </select>
          </FilterField>
          <h3>Действующие возможности</h3>
          <ul className="dsh-qa-admin__effective">
            {detail.effective.map((row) => (
              <li key={row.subroleId}>
                <strong>{row.name}</strong>
                <span>
                  {/* The counts say what a chat under this profile resolves:
                      the pinned system tools included, the skill-grantable
                      ceiling reported as a ceiling rather than as visibility,
                      and a withdrawal subtracted from both. */}
                  {`${formatCount(row.tools)} инструментов${
                    row.grantableTools === 0
                      ? ""
                      : ` (плюс ${formatCount(row.grantableTools)} по навыкам)`
                  }${
                    row.deniedTools === 0
                      ? ""
                      : ` (минус ${formatCount(row.deniedTools)} запрещённых)`
                  }, ${formatCount(row.skills)} навыков`}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="dsh-qa-admin__panel">
          <h2>Активность</h2>
          <dl className="dsh-qa-admin__facts">
            <dt>Разговоры</dt>
            <dd>{formatCount(detail.activity.conversations)}</dd>
            <dt>Сообщения</dt>
            <dd>
              {/* The count lives where the logs are read anyway: the
                  conversations page. Reading every conversation here made the
                  card wait minutes on a real store. */}
              <span
                title={
                  detail.activity.messages === null
                    ? "Считается на странице «Разговоры»"
                    : undefined
                }
              >
                {detail.activity.messages === null
                  ? "—"
                  : formatCount(detail.activity.messages)}
              </span>
            </dd>
            <dt>Положительные оценки</dt>
            <dd>{formatCount(detail.activity.positiveRatings)}</dd>
            <dt>Негативные оценки</dt>
            <dd>{formatCount(detail.activity.negativeRatings)}</dd>
          </dl>
          <div className="dsh-qa-admin__actions">
            <button
              type="button"
              onClick={() => props.onOpenConversations(detail.user.id)}
            >
              Разговоры пользователя
            </button>
            <button type="button" onClick={props.onOpenAudit}>
              История изменений
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
