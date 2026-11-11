import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { QaChatCodeSources } from "../../types/code-sources.js";
import {
  qaModelKey,
  useQaModelSelection,
  type QaModelSelectionProps,
} from "../use-model-selection.js";

export interface QaComposerSettingsProps {
  readonly model?: QaModelSelectionProps | undefined;
  readonly code?:
    | {
        readonly value: QaChatCodeSources;
        readonly pending: boolean;
        readonly error: string | null;
        readonly disabled: boolean;
        readonly defaultLabel?: string | undefined;
        readonly onSelect: (source: string | null) => Promise<boolean>;
      }
    | undefined;
}
type Page = "root" | "model" | "code";

function Chevron({ back = false }: { readonly back?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={back ? "m10 4-4 4 4 4" : "m6 4 4 4-4 4"} />
    </svg>
  );
}
function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 8 3 3 6-6" />
    </svg>
  );
}

/** A single quiet trigger; model and source choices keep their own Host boundaries. */
export function QaComposerSettings(props: QaComposerSettingsProps) {
  const model = useQaModelSelection(props.model);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>("root");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const currentPage = useRef(page);
  currentPage.current = page;
  const popupId = useId();
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setPage("root");
    if (restoreFocus) trigger.current?.focus();
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = popup.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      setPosition({
        left: Math.max(
          8,
          Math.min(anchor.left, window.innerWidth - box.width - 8),
        ),
        top: Math.max(
          8,
          Math.min(
            anchor.top - box.height - 8,
            window.innerHeight - box.height - 8,
          ),
        ),
      });
    };
    place();
    const focus =
      popup.current?.querySelector<HTMLButtonElement>(
        '[aria-checked="true"]:not(:disabled)',
      ) ??
      popup.current?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"]:not(:disabled)',
      ) ??
      popup.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    focus?.focus();
    const resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(place);
    if (popup.current) resize?.observe(popup.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      resize?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, page]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (
        target &&
        !root.current?.contains(target) &&
        !popup.current?.contains(target)
      )
        close(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (currentPage.current === "root") close(true);
      else setPage("root");
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open, close]);

  const code = props.code;
  const showCode =
    code !== undefined &&
    (code.value.entries.length > 0 || code.value.unavailable);
  const showModel =
    props.model !== undefined &&
    (model.options === undefined ||
      model.options.models.length > 1 ||
      model.error !== undefined);
  if (!showCode && !showModel) return null;
  const sourceLabel =
    code?.value.entries.find((entry) => entry.id === code.value.effectiveSource)
      ?.label ??
    (code?.value.unavailable ? "Версия недоступна" : "Версия кода");
  const modelLabel =
    model.selected?.label ?? (props.model === undefined ? "" : "Модель");
  const summary =
    [modelLabel, showCode ? sourceLabel : ""].filter(Boolean).join(" · ") ||
    "Параметры чата";
  const codeDisabled =
    code === undefined ||
    code.disabled ||
    code.pending ||
    !code.value.writable ||
    pending;
  const modelDisabled = model.disabled || pending;
  const error =
    actionError ?? (page === "code" ? code?.error : model.error) ?? null;
  const enter = (next: Page) => {
    setActionError(null);
    setPage(next);
  };
  const choose = async (value: string | null) => {
    if (pending) return;
    if (page === "model" ? modelDisabled : codeDisabled) return;
    setPending(true);
    setActionError(null);
    try {
      const accepted =
        page === "model"
          ? await model.select(value ?? "")
          : code?.value.selectedSource === value ||
            (await code?.onSelect(value));
      if (accepted) close(true);
    } catch {
      setActionError("Не удалось сохранить выбор. Повторите попытку.");
    } finally {
      setPending(false);
    }
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "ArrowLeft" && page !== "root") {
      event.preventDefault();
      event.stopPropagation();
      enter("root");
      return;
    }
    if (event.key === "ArrowRight" && page === "root") {
      const target = event.target as HTMLButtonElement;
      if (target.dataset.page === "model" || target.dataset.page === "code") {
        event.preventDefault();
        event.stopPropagation();
        enter(target.dataset.page);
      }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = [
      ...(popup.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    const active = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={root}
      className="dsh-qa-composer-settings"
      data-testid="qa-composer-settings"
    >
      <button
        ref={trigger}
        type="button"
        className="dsh-qa-composer-settings__trigger"
        data-testid="qa-composer-settings-trigger"
        aria-label="Параметры чата: модель и версия кода"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        title={summary}
        onClick={() => {
          setPage("root");
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setPage("root");
            setOpen(true);
          }
        }}
      >
        <span
          className="dsh-qa-composer-settings__summary"
          data-testid="qa-composer-settings-summary"
        >
          {summary}
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {model.busy || code?.pending ? (
        <span className="dsh-qa-sr-only" role="status">
          Сохраняю параметры чата…
        </span>
      ) : null}
      {open
        ? createPortal(
            <div
              ref={popup}
              id={popupId}
              style={position}
              className="dsh-qa-composer-settings__popup"
              role="menu"
              aria-label={
                page === "root"
                  ? "Параметры чата"
                  : page === "model"
                    ? "Модель чата"
                    : "Версия кода"
              }
              aria-busy={pending || model.busy || code?.pending}
              data-testid="qa-composer-settings-menu"
              onKeyDown={keys}
            >
              {page === "root" ? (
                <>
                  {showModel ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-page="model"
                      data-testid="qa-composer-settings-model"
                      disabled={modelDisabled}
                      aria-haspopup="menu"
                      onClick={() => enter("model")}
                    >
                      <span className="dsh-qa-composer-settings__row-copy">
                        <span>Модель</span>
                        <small>
                          {model.busy
                            ? "Сохраняю…"
                            : (model.selected?.label ?? "Загружаю…")}
                        </small>
                      </span>
                      <Chevron />
                    </button>
                  ) : null}
                  {showCode ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-page="code"
                      data-testid="qa-composer-settings-code"
                      disabled={codeDisabled}
                      aria-haspopup="menu"
                      onClick={() => enter("code")}
                    >
                      <span className="dsh-qa-composer-settings__row-copy">
                        <span>Версия кода</span>
                        <small>
                          {code.pending ? "Сохраняю…" : sourceLabel}
                        </small>
                      </span>
                      <Chevron />
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="dsh-qa-composer-settings__back"
                    data-testid="qa-composer-settings-back"
                    aria-label="Назад к параметрам чата"
                    onClick={() => enter("root")}
                  >
                    <Chevron back />
                    {page === "model" ? "Модель" : "Версия кода"}
                  </button>
                  <div
                    className="dsh-qa-composer-settings__options"
                    role="group"
                    aria-label={
                      page === "model"
                        ? "Доступные модели"
                        : "Доступные версии кода"
                    }
                  >
                    {page === "model" ? (
                      model.options?.models.map((entry) => (
                        <button
                          key={qaModelKey(entry)}
                          type="button"
                          role="menuitemradio"
                          data-testid="qa-composer-settings-model-option"
                          aria-checked={qaModelKey(entry) === model.selectedKey}
                          disabled={modelDisabled}
                          onClick={() => void choose(qaModelKey(entry))}
                        >
                          <span className="dsh-qa-composer-settings__row-copy">
                            <span>{entry.label}</span>
                            <small>
                              {entry.provider}
                              {model.options?.defaultModel &&
                              qaModelKey(entry) ===
                                qaModelKey(model.options.defaultModel)
                                ? " · по умолчанию"
                                : ""}
                            </small>
                          </span>
                          {qaModelKey(entry) === model.selectedKey ? (
                            <Check />
                          ) : null}
                        </button>
                      ))
                    ) : (
                      <>
                        <button
                          type="button"
                          role="menuitemradio"
                          data-testid="qa-composer-settings-source-default"
                          aria-checked={code?.value.selectedSource === null}
                          disabled={codeDisabled}
                          onClick={() => void choose(null)}
                        >
                          <span className="dsh-qa-composer-settings__row-copy">
                            <span>По умолчанию</span>
                            {code?.defaultLabel ? (
                              <small>{code.defaultLabel}</small>
                            ) : null}
                          </span>
                          {code?.value.selectedSource === null ? (
                            <Check />
                          ) : null}
                        </button>
                        {code?.value.entries.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            role="menuitemradio"
                            data-testid="qa-composer-settings-source-option"
                            aria-checked={
                              code.value.selectedSource === entry.id
                            }
                            disabled={codeDisabled}
                            onClick={() => void choose(entry.id)}
                          >
                            <span className="dsh-qa-composer-settings__row-copy">
                              <span>{entry.label}</span>
                            </span>
                            {code.value.selectedSource === entry.id ? (
                              <Check />
                            ) : null}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
              {error ? (
                <p className="dsh-qa-composer-settings__error" role="alert">
                  {error}
                </p>
              ) : null}
              {code?.value.unavailable && page === "code" ? (
                <p className="dsh-qa-composer-settings__error" role="status">
                  Источник удалён из настроек. Выберите другую версию.
                </p>
              ) : null}
              {model.error ? (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qa-composer-settings-retry"
                  disabled={model.busy}
                  onClick={model.reload}
                >
                  Обновить модели
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
