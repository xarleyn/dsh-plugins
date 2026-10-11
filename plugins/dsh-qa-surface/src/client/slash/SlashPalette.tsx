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

/** Whether a Host-supplied description is written in the surface's language. */
const isCyrillic = /[А-Яа-яЁё]/u;

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
      data-testid="qa-slash"
      role="listbox"
      id={`${props.idPrefix}-list`}
      aria-label="Навыки и команды"
    >
      {message === null ? null : (
        <p
          className="dsh-qa-slash__empty"
          data-testid="qa-slash-message"
          role="presentation"
        >
          {message}
        </p>
      )}
      {groups.map((group) => (
        <div
          key={group.kind}
          role="group"
          aria-label={KIND_GROUP[group.kind]}
          className="dsh-qa-slash__group"
          data-testid="qa-slash-group"
        >
          <p
            className="dsh-qa-slash__group-title"
            data-testid="qa-slash-group-title"
            role="presentation"
          >
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
                data-testid="qa-slash-row"
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
                <span
                  className="dsh-qa-slash__head"
                  data-testid="qa-slash-row-head"
                >
                  <span
                    className="dsh-qa-slash__name"
                    data-testid="qa-slash-row-name"
                  >{`/${entry.name}`}</span>
                  {props.showKindBadge ? (
                    <span
                      className={`dsh-qa-slash__kind dsh-qa-slash__kind--${entry.kind}`}
                      data-testid="qa-slash-row-kind"
                    >
                      {KIND_LABEL[entry.kind]}
                    </span>
                  ) : null}
                </span>
                {props.showDescriptions && entry.description !== "" ? (
                  // A description is the Host's own catalog copy, shown as it
                  // stands: it names what the model is about to run, and a
                  // translation here would be a second, wrong name for the
                  // thing. The palette's Russian labels and this line do meet on
                  // one screen, so the switch between them is announced rather
                  // than left for the reader's voice to guess.
                  <span
                    className="dsh-qa-slash__description"
                    data-testid="qa-slash-row-description"
                    lang={isCyrillic.test(entry.description) ? "ru" : "en"}
                  >
                    {entry.description}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
      {props.commandSurface === "inactive" && props.rows.length > 0 ? (
        <p
          className="dsh-qa-slash__hint"
          data-testid="qa-slash-inactive-hint"
          role="presentation"
        >
          Команды появятся, когда у чата будет активная сессия.
        </p>
      ) : null}
    </div>
  );
});
