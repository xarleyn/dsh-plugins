import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  historyFolderOf,
  importIntegrationFolders,
  insertHistoryId,
  moveHistoryChat,
  orderHistoryRows,
  removeHistoryFolder,
  type QaHistoryDestination,
  type QaHistoryFolder,
} from "../history-organization.js";
import { useHistoryOrganization } from "../use-history-organization.js";
import { QaSettingsButton, QaSettingsField } from "../user-settings/fields.js";
import { QaModal } from "./QaModal.js";
import type { QaChatRow, QaSidebarSection } from "./QaSidebar.js";

export interface QaHistoryRowActions {
  readonly pinned: boolean;
  readonly onTogglePin: () => void;
  readonly onMove: () => void;
  readonly onEarlier?: () => void;
  readonly onLater?: () => void;
}

type Drag = { kind: "chat" | "folder"; id: string };
type Dialog =
  | { kind: "create" }
  | { kind: "rename" | "delete"; folder: QaHistoryFolder }
  | { kind: "move"; row: QaChatRow };
const DRAG_TYPE = "application/x-dsh-qa-history";

/** Presentation only: no native workspace or session mutation is issued here. */
export function QaHistoryCatalog(props: {
  readonly storageKey: string;
  readonly rows: readonly QaChatRow[];
  readonly query: string;
  readonly integrationFolders?: Readonly<
    Record<string, import("../../types/accounts.js").QaHistoryFolderTarget>
  >;
  readonly sectionsOf: (
    rows: readonly QaChatRow[],
  ) => readonly QaSidebarSection[];
  readonly renderRow: (
    row: QaChatRow,
    actions: QaHistoryRowActions,
  ) => ReactNode;
}) {
  const { state, update, persistenceFailed } = useHistoryOrganization(
    props.storageKey,
  );
  const [dialog, setDialog] = useState<Dialog | null>(null);
  useEffect(() => {
    if (props.integrationFolders === undefined) return;
    const next = importIntegrationFolders(
      state,
      props.integrationFolders,
      new Set(props.rows.map((row) => row.id)),
    );
    if (next !== state) update(next);
  }, [state, props.integrationFolders, props.rows, update]);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [edge, setEdge] = useState<"before" | "after">("before");
  const [announcement, setAnnouncement] = useState("");
  const drag = useRef<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | string | null>(null);
  useEffect(() => {
    if (dialog !== null || returnFocus.current === null) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    const row =
      typeof target === "string"
        ? [
            ...(root.current?.querySelectorAll<HTMLElement>("[data-chat-id]") ??
              []),
          ].find((entry) => entry.dataset.chatId === target)
        : null;
    const control =
      typeof target === "string"
        ? row?.querySelector<HTMLElement>("button")
        : target.isConnected
          ? target
          : null;
    (control ?? root.current?.querySelector<HTMLElement>("button"))?.focus({
      preventScroll: true,
    });
  }, [state, dialog]);
  const pinned = new Set(state.pinned);
  const query = props.query;
  const matches = (row: QaChatRow) =>
    query === "" ||
    [
      row.title,
      row.fullName,
      row.ownerName,
      state.folders.find(
        (folder) => folder.id === historyFolderOf(state, row.id),
      )?.name,
    ].some((text) => text?.toLowerCase().includes(query));
  const ordered = orderHistoryRows(props.rows, state.order);
  const visibleIds = props.rows.map((row) => row.id);
  const begin = (event: DragEvent, value: Drag) => {
    drag.current = value;
    event.dataTransfer.setData(DRAG_TYPE, value.id);
    event.dataTransfer.effectAllowed = "move";
  };
  const end = () => {
    drag.current = null;
    setHover(null);
  };
  const moveChat = (
    id: string,
    target: QaHistoryDestination,
    anchor?: string,
  ) => {
    if (!props.rows.some((row) => row.id === id)) return;
    returnFocus.current = id;
    update(moveHistoryChat(state, id, target, visibleIds, anchor));
    const title = props.rows.find((row) => row.id === id)?.title ?? "Чат";
    setAnnouncement(
      target.kind === "pinned"
        ? `Чат «${title}» закреплён`
        : `Чат «${title}» перемещён: ${state.folders.find((folder) => folder.id === target.id)?.name ?? "Без каталога"}`,
    );
  };
  const open = (value: Dialog) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setName(value.kind === "rename" ? value.folder.name : "");
    setDestination(
      value.kind === "move" ? (historyFolderOf(state, value.row.id) ?? "") : "",
    );
    setDialog(value);
  };
  const togglePin = (row: QaChatRow) => {
    returnFocus.current = row.id;
    if (pinned.has(row.id)) {
      update({ ...state, pinned: state.pinned.filter((id) => id !== row.id) });
      setAnnouncement(`Чат «${row.title}» откреплён`);
    } else moveChat(row.id, { kind: "pinned" });
  };
  const renderRows = (
    rows: readonly QaChatRow[],
    target: QaHistoryDestination,
  ) =>
    props.sectionsOf(rows).map((section) => (
      <div
        key={section.name || "__all"}
        className="dsh-qa-sidebar__group"
        data-testid="qa-surface-sidebar-group"
      >
        {section.name === "" ? null : (
          <div
            className="dsh-qa-sidebar__group-name"
            data-testid="qa-surface-sidebar-group-name"
          >
            {section.name} ({section.rows.length})
          </div>
        )}
        {section.rows.map((row) => (
          <div
            key={row.id}
            draggable
            data-testid="qa-history-draggable-chat"
            data-chat-id={row.id}
            className="dsh-qa-history__row"
            data-drop={hover === `chat:${row.id}` ? edge : undefined}
            onDragStart={(event) => begin(event, { kind: "chat", id: row.id })}
            onDragEnd={end}
            onDragOver={(event) => {
              if (drag.current?.kind !== "chat" || drag.current.id === row.id)
                return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              const box = event.currentTarget.getBoundingClientRect();
              setEdge(
                event.clientY > box.top + box.height / 2 ? "after" : "before",
              );
              setHover(`chat:${row.id}`);
            }}
            onDrop={(event) => {
              if (drag.current?.kind !== "chat") return;
              event.preventDefault();
              event.stopPropagation();
              const box = event.currentTarget.getBoundingClientRect();
              const after = event.clientY > box.top + box.height / 2;
              moveChat(
                drag.current.id,
                target,
                after
                  ? rows[rows.findIndex((entry) => entry.id === row.id) + 1]?.id
                  : row.id,
              );
              end();
            }}
          >
            {props.renderRow(row, {
              pinned: pinned.has(row.id),
              onTogglePin: () => togglePin(row),
              onMove: () => open({ kind: "move", row }),
              ...(rows[0]?.id === row.id
                ? {}
                : {
                    onEarlier: () =>
                      moveChat(
                        row.id,
                        target,
                        rows[rows.findIndex((entry) => entry.id === row.id) - 1]
                          ?.id,
                      ),
                  }),
              ...(rows.at(-1)?.id === row.id
                ? {}
                : {
                    onLater: () =>
                      moveChat(
                        row.id,
                        target,
                        rows[rows.findIndex((entry) => entry.id === row.id) + 2]
                          ?.id,
                      ),
                  }),
            })}
          </div>
        ))}
      </div>
    ));

  const zone = (
    id: string,
    title: string,
    rows: readonly QaChatRow[],
    target: QaHistoryDestination,
    folder?: QaHistoryFolder,
  ) => {
    const filtered = folder?.name.toLowerCase().includes(query)
      ? rows
      : rows.filter(matches);
    if (
      query !== "" &&
      filtered.length === 0 &&
      !folder?.name.toLowerCase().includes(query)
    )
      return null;
    const expanded = query !== "" || folder?.collapsed !== true;
    return (
      <section
        key={id}
        className="dsh-qa-history__section"
        data-testid="qa-history-section"
        data-history-section={id}
        aria-label={title}
        data-drop={
          hover === id
            ? drag.current?.kind === "folder"
              ? edge
              : "inside"
            : undefined
        }
        onDragOver={(event) => {
          const source = drag.current;
          if (!source || (source.kind === "folder" && !folder)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const box = event.currentTarget.getBoundingClientRect();
          setEdge(
            event.clientY > box.top + box.height / 2 ? "after" : "before",
          );
          setHover(id);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setHover(null);
        }}
        onDrop={(event) => {
          const source = drag.current;
          if (!source) return;
          event.preventDefault();
          if (source.kind === "folder" && folder) {
            const box = event.currentTarget.getBoundingClientRect();
            const after = event.clientY > box.top + box.height / 2;
            const next =
              state.folders[
                state.folders.findIndex((entry) => entry.id === folder.id) + 1
              ];
            const order = insertHistoryId(
              state.folders.map((entry) => entry.id),
              source.id,
              after ? next?.id : folder.id,
            );
            update({
              ...state,
              folders: order.flatMap((key) =>
                state.folders.filter((entry) => entry.id === key),
              ),
            });
            setAnnouncement("Порядок каталогов изменён");
          } else if (source.kind === "chat") moveChat(source.id, target);
          end();
        }}
      >
        <div
          className="dsh-qa-history__heading"
          draggable={folder !== undefined}
          onDragStart={
            folder
              ? (event) => begin(event, { kind: "folder", id: folder.id })
              : undefined
          }
          onDragEnd={end}
        >
          {folder ? (
            <button
              type="button"
              className="dsh-qa-history__title"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Свернуть" : "Развернуть"} каталог «${title}»`}
              onClick={() =>
                update({
                  ...state,
                  folders: state.folders.map((entry) =>
                    entry.id === folder.id
                      ? { ...entry, collapsed: !entry.collapsed }
                      : entry,
                  ),
                })
              }
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d={expanded ? "m4 6 4 4 4-4" : "m6 4 4 4-4 4"} />
              </svg>
              <span>{title}</span>
              <span>{rows.length}</span>
            </button>
          ) : (
            <span className="dsh-qa-history__title">
              {title}
              <span>{rows.length}</span>
            </span>
          )}
          {folder ? (
            <button
              type="button"
              className="dsh-qa-history__edit"
              aria-label={`Настроить каталог «${title}»`}
              title="Настроить каталог"
              onClick={() => open({ kind: "rename", folder })}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3" cy="8" r="1" />
                <circle cx="8" cy="8" r="1" />
                <circle cx="13" cy="8" r="1" />
              </svg>
            </button>
          ) : null}
        </div>
        {expanded ? renderRows(filtered, target) : null}
        {expanded && rows.length === 0 ? (
          <p className="dsh-qa-history__hint">
            {target.kind === "pinned"
              ? "Перетащите чат для закрепления"
              : "Перетащите сюда чат"}
          </p>
        ) : null}
      </section>
    );
  };
  const validName = name.trim();
  const duplicate = state.folders.some(
    (folder) =>
      folder.name.toLowerCase() === validName.toLowerCase() &&
      (dialog?.kind !== "rename" || folder.id !== dialog.folder.id),
  );
  const saveName = () => {
    if (!validName || duplicate) return;
    if (dialog?.kind === "create")
      update({
        ...state,
        folders: [
          ...state.folders,
          { id: crypto.randomUUID(), name: validName, collapsed: false },
        ],
      });
    if (dialog?.kind === "rename")
      update({
        ...state,
        folders: state.folders.map((folder) =>
          folder.id === dialog.folder.id
            ? { ...folder, name: validName }
            : folder,
        ),
      });
    setDialog(null);
  };
  const found =
    props.rows.some(matches) ||
    state.folders.some((folder) => folder.name.toLowerCase().includes(query));
  return (
    <div ref={root} className="dsh-qa-history">
      <button
        type="button"
        className="dsh-qa-history__create"
        data-testid="qa-history-create-folder"
        onClick={() => open({ kind: "create" })}
      >
        + Новый каталог
      </button>
      {persistenceFailed ? (
        <p role="alert" className="dsh-qa-history__hint">
          Браузер не сохранил изменения. Они действуют до перезагрузки страницы.
        </p>
      ) : null}
      <span
        className="dsh-qa-history__announcement"
        role="status"
        aria-live="polite"
      >
        {announcement}
      </span>
      {query !== "" && !found ? (
        <p
          className="dsh-qa-sidebar__empty"
          data-testid="qa-surface-sidebar-empty"
        >
          Ничего не найдено
        </p>
      ) : null}
      {zone(
        "pinned",
        "Закреплённые",
        orderHistoryRows(
          props.rows.filter((row) => pinned.has(row.id)),
          state.pinned,
        ),
        { kind: "pinned" },
      )}
      {state.folders.map((folder) =>
        zone(
          folder.id,
          folder.name,
          ordered.filter(
            (row) =>
              !pinned.has(row.id) &&
              historyFolderOf(state, row.id) === folder.id,
          ),
          { kind: "folder", id: folder.id },
          folder,
        ),
      )}
      {zone(
        "ungrouped",
        "Без каталога",
        ordered.filter(
          (row) =>
            !pinned.has(row.id) && historyFolderOf(state, row.id) === null,
        ),
        { kind: "folder", id: null },
      )}
      {props.rows.length === 0 && query === "" ? (
        <p
          className="dsh-qa-sidebar__empty"
          data-testid="qa-surface-sidebar-empty"
        >
          Здесь пока пусто
        </p>
      ) : null}
      <QaModal
        open={dialog !== null}
        title={
          dialog?.kind === "move"
            ? `Переместить чат «${dialog.row.title}»`
            : dialog?.kind === "delete"
              ? "Удалить каталог?"
              : dialog?.kind === "rename"
                ? "Настроить каталог"
                : "Новый каталог"
        }
        closeLabel="Закрыть каталог"
        onClose={() => setDialog(null)}
        footer={
          <>
            <QaSettingsButton label="Отмена" onClick={() => setDialog(null)} />
            {dialog?.kind === "rename" ? (
              <QaSettingsButton
                label="Удалить каталог"
                tone="danger"
                onClick={() =>
                  setDialog({ kind: "delete", folder: dialog.folder })
                }
              />
            ) : null}
            <QaSettingsButton
              label={
                dialog?.kind === "move"
                  ? "Переместить"
                  : dialog?.kind === "delete"
                    ? "Удалить каталог"
                    : "Сохранить"
              }
              disabled={
                (dialog?.kind === "create" || dialog?.kind === "rename") &&
                (!validName || duplicate)
              }
              onClick={() => {
                if (dialog?.kind === "move") {
                  moveChat(dialog.row.id, {
                    kind: "folder",
                    id: destination || null,
                  });
                  setDialog(null);
                } else if (dialog?.kind === "delete") {
                  update(removeHistoryFolder(state, dialog.folder.id));
                  setDialog(null);
                } else saveName();
              }}
            />
          </>
        }
      >
        {dialog?.kind === "delete" ? (
          <p>
            Каталог «{dialog.folder.name}» будет удалён. Чаты останутся в
            истории без каталога, закреплённые сохранят закрепление.
          </p>
        ) : dialog?.kind === "move" ? (
          <QaSettingsField label="Каталог" testId="qa-history-destination">
            <select
              aria-label="Каталог"
              value={destination}
              onChange={(event) => setDestination(event.currentTarget.value)}
            >
              <option value="">Без каталога</option>
              {state.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </QaSettingsField>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveName();
            }}
          >
            <QaSettingsField
              label="Название каталога"
              testId="qa-history-folder-name"
              hint="Виртуальный каталог хранится в этом браузере. Файлы сессий остаются на месте."
            >
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </QaSettingsField>
            {duplicate ? (
              <p role="alert">Каталог с таким названием уже существует.</p>
            ) : null}
          </form>
        )}
        {dialog?.kind === "rename" ? (
          <div className="dsh-qa-history__order">
            <QaSettingsButton
              label="Каталог выше"
              disabled={state.folders[0]?.id === dialog.folder.id}
              onClick={() => {
                const index = state.folders.findIndex(
                  (folder) => folder.id === dialog.folder.id,
                );
                const previous = state.folders[index - 1];
                if (!previous) return;
                const order = insertHistoryId(
                  state.folders.map((folder) => folder.id),
                  dialog.folder.id,
                  previous.id,
                );
                update({
                  ...state,
                  folders: order.flatMap((id) =>
                    state.folders.filter((folder) => folder.id === id),
                  ),
                });
              }}
            />
            <QaSettingsButton
              label="Каталог ниже"
              disabled={state.folders.at(-1)?.id === dialog.folder.id}
              onClick={() => {
                const index = state.folders.findIndex(
                  (folder) => folder.id === dialog.folder.id,
                );
                const next = state.folders[index + 1];
                if (!next) return;
                const folders = [...state.folders];
                folders.splice(index, 2, next, dialog.folder);
                update({ ...state, folders });
              }}
            />
          </div>
        ) : null}
      </QaModal>
    </div>
  );
}
