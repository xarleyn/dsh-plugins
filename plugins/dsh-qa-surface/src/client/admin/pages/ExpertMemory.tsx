import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QaExpertMemoryRecord,
  QaExpertMemoryScope,
} from "../../../types.js";
import type { QaAdminApi } from "../../types.js";
import {
  Badge,
  Empty,
  ErrorLine,
  FilterField,
  Pager,
  Stamp,
  adminErrorMessage,
  useAdminResource,
  useRequestSlot,
} from "../shared.js";

const PAGE_SIZE = 25;

/** Tags cross the wire as a list; an operator edits them as one line. */
function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
    ),
  ];
}

/**
 * What the domain experts remembered.
 *
 * An expert writes its own notes, and a note that turned out to be wrong keeps
 * being injected into every later answer of that domain until someone deletes
 * it. This page is for that someone. The edit is deliberately narrow — the text
 * and its tags, never the key, which is what the audit trail and the expert's
 * own `forget` calls point at.
 *
 * A reviewer opens the same list read-only: seeing what an expert believes is
 * the half of the job that produces the report "this is wrong".
 */
export function AdminExpertMemory(props: {
  readonly api: QaAdminApi;
  readonly token: string;
  readonly canManage: boolean;
}) {
  const { api, token, canManage } = props;
  const [namespace, setNamespace] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<readonly QaExpertMemoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const request = useRequestSlot();

  const scopes = useAdminResource<readonly QaExpertMemoryScope[]>(
    () => api.memoryScopes(token),
    [api, token],
  );
  const available = useMemo(() => scopes.data ?? [], [scopes.data]);

  // What the page reads is the selection or, before anyone picks, the first
  // namespace the stand has. A namespace that stopped existing (an expert
  // deleted while this page was open) falls back instead of asking the Host for
  // something no expert claims.
  const active = useMemo(() => {
    if (available.some((entry) => entry.namespace === namespace)) {
      return namespace;
    }
    return namespace === "" ? (available[0]?.namespace ?? "") : "";
  }, [available, namespace]);
  const scope = available.find((entry) => entry.namespace === active);
  const writable = canManage && scope?.access === "read-write";

  const load = useCallback(
    async (from: number, append: boolean) => {
      if (active === "") {
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      const controller = request.start();
      setLoading(true);
      const result = await api.memoryRecords(
        token,
        active,
        query,
        PAGE_SIZE,
        from,
      );
      // A page the operator changed or left while the Host was still reading it
      // has no answer worth showing.
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!result.ok) {
        setListError(adminErrorMessage(result.error));
        return;
      }
      setListError(undefined);
      setTotal(result.value.total);
      setRows((current) =>
        append ? [...current, ...result.value.records] : result.value.records,
      );
    },
    [request, api, token, active, query],
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  // Selection and the open editor belong to the list they were made against: a
  // new filter, another namespace, or another minute of experts writing means
  // the ticks no longer name what the operator saw.
  useEffect(() => {
    setSelected(new Set<string>());
    setEditing(undefined);
    setNotice(undefined);
  }, [active, query]);

  /** One maintenance write, then the fresh list: the store is not the browser's. */
  const mutate = useCallback(
    async (
      message: () => string,
      action: () => Promise<string | undefined>,
    ) => {
      setBusy(true);
      setActionError(undefined);
      try {
        const failure = await action();
        if (failure !== undefined) {
          setActionError(failure);
          return;
        }
        setNotice(message());
        await load(0, false);
      } catch (error) {
        setActionError(adminErrorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const save = useCallback(
    (key: string, text: string, tags: readonly string[]) =>
      mutate(
        () => `Запись ${key} исправлена.`,
        async () => {
          const result = await api.correctMemory(token, active, key, {
            text,
            tags,
          });
          if (result.ok) return undefined;
          setEditing(undefined);
          return adminErrorMessage(result.error);
        },
      ),
    [api, token, active, mutate],
  );

  const forget = useCallback(
    (keys: readonly string[]) => {
      // The ticks are spent the moment they are acted on: a failed write leaves
      // them cleared too, and re-selecting is cheaper than tracking which of
      // them the Host honoured.
      setSelected(new Set<string>());
      return mutate(
        () =>
          keys.length === 1
            ? `Запись ${keys[0] ?? ""} удалена.`
            : `Удалено записей: ${String(keys.length)}.`,
        async () => {
          const result = await api.forgetMemory(token, active, keys);
          if (result.ok) return undefined;
          return adminErrorMessage(result.error);
        },
      );
    },
    [api, token, active, mutate],
  );

  const wipe = useCallback(
    () =>
      mutate(
        () => `Пространство ${active} очищено.`,
        async () => {
          // The count the operator was shown is the count they agreed to erase;
          // what an expert wrote in the meantime is not part of that.
          const result = await api.wipeMemory(token, active, total);
          if (result.ok) return undefined;
          return adminErrorMessage(result.error);
        },
      ),
    [api, token, active, total, mutate],
  );

  // The scope list is the page's authorization probe as well: a role the Host
  // refuses answers with a reason code, and the console is the side that knows
  // how to phrase it.
  const failure =
    (scopes.error === undefined
      ? undefined
      : adminErrorMessage(scopes.error)) ??
    listError ??
    actionError;

  return (
    <section
      className="dsh-qa-admin__page"
      data-testid="qa-admin-memory"
      aria-label="Память экспертов"
    >
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Память экспертов</h1>
          <p>
            Что домены записали себе сами — это подмешивается в каждый следующий
            ответ той же области. Неточную строку можно исправить или удалить.
            Ключ записи остаётся: на него ссылается журнал правок и сам эксперт.
            {canManage
              ? ""
              : " Роль ревьюера видит память, но не правит её — для правки нужен администратор."}
          </p>
        </div>
        {canManage && active !== "" && total > 0 ? (
          <div className="dsh-qa-admin__title-actions">
            <button
              type="button"
              data-testid="qa-admin-memory-wipe"
              className="dsh-qa-admin__danger"
              disabled={busy || !writable}
              onClick={() => {
                if (
                  !window.confirm(
                    `Очистить всю память ${active}? Будет удалено ${String(total)} записей. Эксперты перестанут помнить то, что было записано в этом пространстве, и восстановить это будет нельзя.`,
                  )
                )
                  return;
                void wipe();
              }}
            >
              Очистить пространство
            </button>
            {writable ? null : (
              <p className="dsh-qa-admin__panel-note">
                Это пространство читается всеми домены и правится у своего
                владельца.
              </p>
            )}
          </div>
        ) : null}
      </div>
      <ErrorLine message={failure} testId="qa-admin-memory-error" />
      {notice === undefined ? null : (
        <p
          className="dsh-qa-admin__notice"
          data-testid="qa-admin-memory-notice"
        >
          {notice}
        </p>
      )}
      {available.length === 0 ? (
        failure === undefined ? (
          <Empty>
            {scopes.loading
              ? "Загружаю…"
              : "На этом стенде нет экспертов с памятью: плагин доменов не установлен, выключен, или ни один эксперт ещё ничего не записал."}
          </Empty>
        ) : null
      ) : (
        <>
          <div
            className="dsh-qa-admin__filters"
            data-testid="qa-admin-memory-filters"
          >
            <FilterField label="Эксперт" testId="qa-admin-memory-filter-expert">
              <select
                data-testid="qa-admin-memory-expert"
                value={active}
                onChange={(event) => setNamespace(event.currentTarget.value)}
              >
                {available.map((entry) => (
                  <option
                    key={`${entry.domainId}:${entry.namespace}`}
                    value={entry.namespace}
                  >
                    {entry.domainName} · {entry.namespace} ·{" "}
                    {String(entry.records)}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Поиск" testId="qa-admin-memory-filter-search">
              <input
                type="search"
                data-testid="qa-admin-memory-search"
                value={query}
                placeholder="Текст, ключ или тег"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </FilterField>
          </div>
          {selected.size > 0 && writable ? (
            <div
              className="dsh-qa-admin__actions"
              data-testid="qa-admin-memory-bulk-actions"
            >
              <button
                type="button"
                data-testid="qa-admin-memory-delete-selected"
                className="dsh-qa-admin__danger"
                disabled={busy}
                onClick={() => {
                  const keys = [...selected];
                  if (
                    !window.confirm(
                      `Удалить выбранные записи (${String(keys.length)})?`,
                    )
                  )
                    return;
                  void forget(keys);
                }}
              >
                Удалить выбранное ({String(selected.size)})
              </button>
              <button
                type="button"
                data-testid="qa-admin-memory-clear-selection"
                onClick={() => setSelected(new Set<string>())}
              >
                Снять выделение
              </button>
            </div>
          ) : null}
          {rows.length === 0 ? (
            <Empty>
              {loading
                ? "Загружаю…"
                : query === ""
                  ? "В этом пространстве пока ничего не записано."
                  : "Ничего не нашлось по этому запросу."}
            </Empty>
          ) : (
            <table
              className="dsh-qa-admin__table"
              data-testid="qa-admin-memory-table"
            >
              <thead>
                <tr>
                  {writable ? (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Выбрать все записи на странице"
                        data-testid="qa-admin-memory-select-all"
                        checked={selected.size === rows.length}
                        onChange={(event) =>
                          setSelected(
                            event.currentTarget.checked
                              ? new Set(rows.map((row) => row.key))
                              : new Set<string>(),
                          )
                        }
                      />
                    </th>
                  ) : null}
                  <th>Запись</th>
                  <th>Что запомнилось</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => (
                  <MemoryRow
                    key={record.key}
                    record={record}
                    writable={writable}
                    busy={busy}
                    selected={selected.has(record.key)}
                    editing={editing === record.key}
                    onSelect={(on) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (on) next.add(record.key);
                        else next.delete(record.key);
                        return next;
                      })
                    }
                    onEdit={() => setEditing(record.key)}
                    onCancel={() => setEditing(undefined)}
                    onSave={(text, tags) => {
                      setEditing(undefined);
                      void save(record.key, text, tags);
                    }}
                    onDelete={() => {
                      if (
                        !window.confirm(
                          `Удалить запись ${record.key}? Эксперты больше не будут её помнить.`,
                        )
                      )
                        return;
                      void forget([record.key]);
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
          <Pager
            total={total}
            shown={rows.length}
            hasMore={rows.length < total}
            loading={loading}
            onMore={() => void load(rows.length, true)}
            onReset={() => void load(0, false)}
          />
        </>
      )}
    </section>
  );
}

/**
 * One remembered line, and the editor it opens into.
 *
 * The draft lives with the row: text and tags are edited together, and lifting
 * them to the page would mean the page tracking which record each keystroke
 * belongs to for no benefit the operator can see.
 */
function MemoryRow(props: {
  readonly record: QaExpertMemoryRecord;
  readonly writable: boolean;
  readonly busy: boolean;
  readonly selected: boolean;
  readonly editing: boolean;
  readonly onSelect: (on: boolean) => void;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: (text: string, tags: readonly string[]) => void;
  readonly onDelete: () => void;
}) {
  const { record } = props;
  const [text, setText] = useState(record.text);
  const [tags, setTags] = useState(record.tags.join(", "));
  // The row shows what the store holds. When a reload brings a newer version of
  // the same key — an expert wrote it again while the editor was open — the
  // draft is describing a record that no longer exists, so it is dropped.
  const [shown, setShown] = useState(record.updatedAt);
  if (shown !== record.updatedAt) {
    setShown(record.updatedAt);
    setText(record.text);
    setTags(record.tags.join(", "));
  }
  const unchanged =
    text === record.text && tags.trim() === record.tags.join(", ").trim();

  return (
    <tr data-testid="qa-admin-memory-row">
      {props.writable ? (
        <td>
          <input
            type="checkbox"
            aria-label={`Выбрать запись ${record.key}`}
            data-testid="qa-admin-memory-select"
            checked={props.selected}
            disabled={props.editing}
            onChange={(event) => props.onSelect(event.currentTarget.checked)}
          />
        </td>
      ) : null}
      <td data-testid="qa-admin-memory-key-cell">
        <strong data-testid="qa-admin-memory-key">{record.key}</strong>
        <small>
          изменена <Stamp value={new Date(record.updatedAt).toISOString()} />
        </small>
        {record.tags.length === 0 ? null : (
          <small data-testid="qa-admin-memory-tags">
            {record.tags.join(", ")}
          </small>
        )}
      </td>
      <td>
        {props.editing ? (
          <div
            className="dsh-qa-admin__memory-editor"
            data-testid="qa-admin-memory-editor"
          >
            <textarea
              aria-label={`Текст записи ${record.key}`}
              data-testid="qa-admin-memory-text-input"
              rows={5}
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
            />
            <input
              type="text"
              aria-label={`Теги записи ${record.key}`}
              data-testid="qa-admin-memory-tag-input"
              placeholder="теги, через запятую"
              value={tags}
              onChange={(event) => setTags(event.currentTarget.value)}
            />
            <div
              className="dsh-qa-admin__actions"
              data-testid="qa-admin-memory-editor-actions"
            >
              <button
                type="button"
                data-testid="qa-admin-memory-save"
                disabled={props.busy || unchanged || text.trim() === ""}
                onClick={() => props.onSave(text, parseTags(tags))}
              >
                Сохранить
              </button>
              <button
                type="button"
                data-testid="qa-admin-memory-cancel"
                disabled={props.busy}
                onClick={() => {
                  setText(record.text);
                  setTags(record.tags.join(", "));
                  props.onCancel();
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <p
            className="dsh-qa-admin__memory-text"
            data-testid="qa-admin-memory-text"
          >
            {record.text}
          </p>
        )}
      </td>
      <td>
        {props.writable ? (
          <div
            className="dsh-qa-admin__actions"
            data-testid="qa-admin-memory-row-actions"
          >
            {props.editing ? null : (
              <button
                type="button"
                data-testid="qa-admin-memory-edit"
                disabled={props.busy}
                onClick={props.onEdit}
              >
                Править
              </button>
            )}
            <button
              type="button"
              data-testid="qa-admin-memory-delete"
              className="dsh-qa-admin__danger"
              disabled={props.busy || props.editing}
              onClick={props.onDelete}
            >
              Удалить
            </button>
          </div>
        ) : (
          <Badge tone="warning" testId="qa-admin-memory-readonly">
            только чтение
          </Badge>
        )}
      </td>
    </tr>
  );
}
