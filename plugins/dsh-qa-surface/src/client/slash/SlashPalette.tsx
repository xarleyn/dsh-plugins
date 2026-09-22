import { memo } from "react";
import type {
  QaSlashCatalogEntry,
  QaSlashCommandSurface,
  QaSlashView,
} from "../../types.js";
import { groupPaletteRows } from "./palette-rows.js";

export interface QaSlashPaletteProps {
  readonly rows: readonly QaSlashCatalogEntry[];
  readonly activeId: string | null;
  readonly state: QaSlashView["state"];
  readonly error: string | null;
  readonly commandSurface: QaSlashCommandSurface;
  readonly showDescriptions: boolean;
  readonly showKindBadge: boolean;
  readonly idPrefix: string;
  readonly onHover: (index: number) => void;
  readonly onPick: (entry: QaSlashCatalogEntry) => void;
}

const KIND_LABEL: Readonly<Record<QaSlashCatalogEntry["kind"], string>> =
  Object.freeze({ skill: "Навык", command: "Команда" });

const KIND_GROUP: Readonly<Record<QaSlashCatalogEntry["kind"], string>> =
  Object.freeze({ skill: "Навыки", command: "Команды" });

/**
 * The palette itself: a listbox over rows the composer has already filtered
 * and ranked. It owns no state — an empty list means "nothing matches", and
 * the surface line says why when the catalog could not be read at all.
 *
 * Options are picked on `click` and never take focus (`onMouseDown` prevents
 * the default) so the caret stays in the textarea: the keyboard keeps working
 * straight after a click, and Escape still closes what the mouse opened.
 */
export const QaSlashPalette = memo(function QaSlashPalette(
  props: QaSlashPaletteProps,
) {
  const message =
    props.state === "error"
      ? (props.error ?? "Не удалось загрузить команды")
      : props.state === "loading"
        ? "Загрузка действий…"
        : props.rows.length === 0
          ? "Ничего не найдено"
          : null;
  // One group per kind, which is also what makes the keys below unique: the
  // rows arrive in the grouped order, so a kind never reappears further down.
  const groups = groupPaletteRows(props.rows);
  return (
    <div
      className="dsh-qa-slash"
      role="listbox"
      id={`${props.idPrefix}-list`}
      aria-label="Навыки и команды"
    >
      {message === null ? null : (
        <p className="dsh-qa-slash__empty" role="presentation">
          {message}
        </p>
      )}
      {groups.map((group) => (
        <div
          key={group.kind}
          role="group"
          aria-label={KIND_GROUP[group.kind]}
          className="dsh-qa-slash__group"
        >
          <p className="dsh-qa-slash__group-title" role="presentation">
            {KIND_GROUP[group.kind]}
          </p>
          {group.rows.map(({ entry, index }) => {
            const selected = entry.id === props.activeId;
            return (
              <div
                key={entry.id}
                id={`${props.idPrefix}-option-${String(index)}`}
                role="option"
                aria-selected={selected}
                className={
                  selected
                    ? "dsh-qa-slash__row dsh-qa-slash__row--active"
                    : "dsh-qa-slash__row"
                }
                onMouseEnter={() => {
                  props.onHover(index);
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  props.onPick(entry);
                }}
              >
                <span className="dsh-qa-slash__head">
                  <span className="dsh-qa-slash__name">{`/${entry.name}`}</span>
                  {props.showKindBadge ? (
                    <span
                      className={`dsh-qa-slash__kind dsh-qa-slash__kind--${entry.kind}`}
                    >
                      {KIND_LABEL[entry.kind]}
                    </span>
                  ) : null}
                </span>
                {props.showDescriptions && entry.description !== "" ? (
                  <span className="dsh-qa-slash__description">
                    {entry.description}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
      {props.commandSurface === "inactive" && props.rows.length > 0 ? (
        <p className="dsh-qa-slash__hint" role="presentation">
          Команды появятся, когда у чата будет активная сессия.
        </p>
      ) : null}
    </div>
  );
});
