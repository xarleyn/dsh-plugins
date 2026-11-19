import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { QaSlashView } from "../../types.js";
import {
  isSearchSource,
  type QaSearchSourceEntry,
} from "../../slash/source-prompt.js";

interface Props {
  readonly slash: QaSlashView;
  readonly disabled: boolean;
  readonly filesFull: boolean;
  readonly onOpen: () => void;
  readonly onAttach: () => void;
  readonly onSelect: (entry: QaSearchSourceEntry) => void;
}

export function QaComposerAddMenu(props: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const sources =
    open && props.slash.enabled && props.slash.state === "ready"
      ? props.slash.entries.filter(isSearchSource)
      : [];
  if (open && props.disabled) setOpen(false);
  const close = () => setOpen(false);
  const show = () => {
    props.onOpen();
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (open)
      (
        menu.current?.querySelector<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? menu.current
      )?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const doc = button.current?.ownerDocument;
    const dismiss = (event: Event) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !button.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    doc?.addEventListener("pointerdown", dismiss);
    doc?.addEventListener("focusin", dismiss);
    return () => {
      doc?.removeEventListener("pointerdown", dismiss);
      doc?.removeEventListener("focusin", dismiss);
    };
  }, [open]);
  const select = (entry: QaSearchSourceEntry) => {
    close();
    props.onSelect(entry);
  };
  return (
    <>
      {open && !props.disabled && (
        <div
          id={id}
          ref={menu}
          role="menu"
          aria-label="Добавить файл или источник"
          tabIndex={-1}
          className="dsh-qa-add-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
              button.current?.focus();
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            if (!items.length) return;
            const index = items.indexOf(
              event.currentTarget.ownerDocument
                .activeElement as HTMLButtonElement,
            );
            let next = event.key === "Home" ? 0 : items.length - 1;
            if (event.key === "ArrowDown") next = (index + 1) % items.length;
            if (event.key === "ArrowUp" && index >= 0)
              next = (index + items.length - 1) % items.length;
            items[next]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={props.filesFull}
            onClick={() => {
              close();
              button.current?.focus();
              props.onAttach();
            }}
          >
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="M16.08 8.29 9.19 15.18a4.5 4.5 0 0 1-6.37-6.37l6.89-6.89a3 3 0 0 1 4.25 4.25l-6.9 6.89a1.5 1.5 0 0 1-2.12-2.12l6.37-6.36" />
            </svg>
            Прикрепить файл
          </button>
          {sources.length > 0 && (
            <div role="group" aria-label="Источники поиска">
              <div className="dsh-qa-add-menu__label">Источники поиска</div>
              {sources.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitem"
                  onClick={() => select(entry)}
                >
                  {entry.searchSource.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button
        ref={button}
        type="button"
        className="dsh-qa-composer__attach"
        data-testid="qa-composer-attach"
        aria-label="Добавить файл или источник"
        title="Добавить файл или источник"
        aria-haspopup="menu"
        aria-expanded={open && !props.disabled}
        aria-controls={open ? id : undefined}
        disabled={props.disabled}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            show();
          }
        }}
        onClick={() => (open ? close() : show())}
      >
        <svg viewBox="0 0 18 18" aria-hidden="true">
          <path d="M9 3v12M3 9h12" />
        </svg>
      </button>
    </>
  );
}
