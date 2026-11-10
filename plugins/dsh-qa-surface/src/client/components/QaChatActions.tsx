import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { QaHistoryRowActions } from "./QaHistoryCatalog.js";

/** Quiet actions attached to one owned chat, outside the conversation header. */
export function QaChatActions(props: {
  name: string;
  onShare?: () => void;
  onDelete?: (trigger: HTMLButtonElement) => void;
  organization?: QaHistoryRowActions;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const box = trigger.current?.getBoundingClientRect();
    const popup = menu.current?.getBoundingClientRect();
    if (box && popup)
      setPosition({
        left: Math.max(
          8,
          Math.min(
            box.right - popup.width,
            window.innerWidth - popup.width - 8,
          ),
        ),
        top: Math.max(
          8,
          Math.min(box.bottom + 8, window.innerHeight - popup.height - 8),
        ),
      });
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      ref={root}
      className="dsh-qa-chat-actions"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !menu.current?.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="dsh-qa-chat-actions__trigger"
        aria-label={`Действия чата ${props.name}`}
        title="Действия чата"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3" cy="8" r="1" />
          <circle cx="8" cy="8" r="1" />
          <circle cx="13" cy="8" r="1" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              style={position}
              className="dsh-qa-chat-actions__menu"
              role="group"
              aria-label="Действия чата"
            >
              {props.organization === undefined ? null : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      trigger.current?.focus();
                      props.organization?.onTogglePin();
                    }}
                  >
                    {props.organization.pinned
                      ? "Открепить чат"
                      : "Закрепить чат"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      trigger.current?.focus();
                      props.organization?.onMove();
                    }}
                  >
                    Переместить в каталог
                  </button>
                  <button
                    type="button"
                    disabled={props.organization.onEarlier === undefined}
                    onClick={() => {
                      setOpen(false);
                      props.organization?.onEarlier?.();
                    }}
                  >
                    Выше в списке
                  </button>
                  <button
                    type="button"
                    disabled={props.organization.onLater === undefined}
                    onClick={() => {
                      setOpen(false);
                      props.organization?.onLater?.();
                    }}
                  >
                    Ниже в списке
                  </button>
                </>
              )}
              {props.onShare === undefined ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    trigger.current?.focus();
                    props.onShare?.();
                  }}
                >
                  Поделиться чатом
                </button>
              )}
              {props.onDelete === undefined ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (trigger.current) props.onDelete?.(trigger.current);
                  }}
                >
                  Удалить чат
                </button>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
