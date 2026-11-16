import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  QA_ANSWER_MODE_NAMES,
  qaAnswerModeTooltip,
  type QaAnswerMode,
} from "../../shared/answer-modes.js";

const MODES: readonly QaAnswerMode[] = ["fast", "deep", "rag"];
const DESCRIPTIONS: Record<QaAnswerMode, string> = {
  fast: "Без автоматического ревью ответов",
  deep: "Документация, проверка гипотез и субагенты",
  rag: "Сначала поиск в LightRAG разными способами",
};

/** Tooltips escape the menu's scroll area and stay inside the viewport. */
function ModeTooltip(props: {
  readonly id: string;
  readonly text: string;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const active = !props.disabled && (hovered || focused);
  useLayoutEffect(() => {
    if (!active) return;
    const place = () => {
      const target = anchor.current?.getBoundingClientRect();
      const box = tip.current?.getBoundingClientRect();
      if (!target || !box) return;
      const above = target.top - box.height - 8;
      setPosition({
        left: Math.max(
          8,
          Math.min(target.right - box.width, window.innerWidth - box.width - 8),
        ),
        top: Math.max(
          8,
          Math.min(
            above >= 8 ? above : target.bottom + 8,
            window.innerHeight - box.height - 8,
          ),
        ),
      });
    };
    place();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [active, props.text]);
  return (
    <span
      ref={anchor}
      className="dsh-qa-modes__tooltip-owner"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {props.children}
      {createPortal(
        <span
          ref={tip}
          id={props.id}
          className="dsh-qa-modes__tooltip"
          role="tooltip"
          data-active={active}
          style={position}
        >
          {props.text}
        </span>,
        document.body,
      )}
    </span>
  );
}

export function QaAnswerModes(props: {
  readonly modes: readonly QaAnswerMode[];
  readonly disabled: boolean;
  readonly onChange: (modes: readonly QaAnswerMode[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const owner = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: 8,
    top: 8,
    "--dsh-qa-accent": "var(--dsw-alias-state-business-primary)",
  });
  const id = useId();
  const label = props.modes
    .map((mode) => QA_ANSWER_MODE_NAMES[mode])
    .join(" + ");
  const tooltip = props.modes
    .map(
      (mode) => `${QA_ANSWER_MODE_NAMES[mode]}: ${qaAnswerModeTooltip(mode)}`,
    )
    .join("\n\n");

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = popup.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      setPosition({
        "--dsh-qa-accent": trigger.current
          ? getComputedStyle(trigger.current)
              .getPropertyValue("--dsh-qa-accent")
              .trim() || "var(--dsw-alias-state-business-primary)"
          : "var(--dsw-alias-state-business-primary)",
        left: Math.max(
          8,
          Math.min(anchor.right - box.width, window.innerWidth - box.width - 8),
        ),
        top: Math.max(
          8,
          Math.min(
            anchor.top - box.height - 10,
            window.innerHeight - box.height - 8,
          ),
        ),
      });
    };
    place();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(schedule);
    if (popup.current) resize?.observe(popup.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      resize?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, label, notice]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !owner.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (props.disabled) setOpen(false);
  }, [props.disabled]);

  return (
    <div
      className="dsh-qa-modes"
      ref={owner}
      onKeyDown={(event) => {
        if (event.key === "Tab" && open) {
          const options = [
            ...(popup.current?.querySelectorAll<HTMLInputElement>("input") ??
              []),
          ];
          const index = options.indexOf(
            document.activeElement as HTMLInputElement,
          );
          const next =
            index < 0
              ? event.shiftKey
                ? options.length - 1
                : 0
              : (index + (event.shiftKey ? -1 : 1) + options.length) %
                options.length;
          if (options[next]) {
            event.preventDefault();
            event.stopPropagation();
            options[next].focus();
          }
        }
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <ModeTooltip id={`${id}-tip`} text={tooltip} disabled={open}>
        <button
          ref={trigger}
          type="button"
          className="dsh-qa-modes__trigger"
          data-testid="qa-composer-modes"
          aria-label={`Режимы ответа: ${label}`}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-describedby={`${id}-tip`}
          disabled={props.disabled}
          onClick={() => {
            setOpen(!open);
            setNotice("");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              requestAnimationFrame(() =>
                popup.current
                  ?.querySelector<HTMLInputElement>("input")
                  ?.focus(),
              );
            }
          }}
        >
          <span>{label}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
      </ModeTooltip>
      {open
        ? createPortal(
            <div
              ref={popup}
              style={position}
              id={`${id}-list`}
              className="dsh-qa-modes__popup"
              role="group"
              aria-label="Режимы ответа"
            >
              <div className="dsh-qa-modes__heading">Режимы ответа</div>
              <p className="dsh-qa-modes__caption">Можно выбрать несколько</p>
              {MODES.map((mode) => (
                <ModeTooltip
                  key={mode}
                  id={`${id}-${mode}-tip`}
                  text={qaAnswerModeTooltip(mode)}
                >
                  <label className="dsh-qa-modes__option">
                    <span className="dsh-qa-modes__text">
                      <span className="dsh-qa-modes__name">
                        {QA_ANSWER_MODE_NAMES[mode]}
                      </span>
                      <span className="dsh-qa-modes__description">
                        {DESCRIPTIONS[mode]}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      aria-label={QA_ANSWER_MODE_NAMES[mode]}
                      aria-describedby={`${id}-${mode}-tip`}
                      checked={props.modes.includes(mode)}
                      onChange={(event) => {
                        const next = MODES.filter((candidate) =>
                          candidate === mode
                            ? event.target.checked
                            : props.modes.includes(candidate),
                        );
                        if (next.length === 0) {
                          setNotice("Выберите хотя бы один режим.");
                          return;
                        }
                        setNotice("");
                        props.onChange(next);
                      }}
                    />
                  </label>
                </ModeTooltip>
              ))}
              {notice ? (
                <p className="dsh-qa-modes__caption" role="status">
                  {notice}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export const QA_ANSWER_MODES_STYLES = `
.dsh-qa-modes{position:relative;flex:0 1 auto;min-width:0;max-width:70%}
.dsh-qa-modes__tooltip-owner{position:relative;display:block}
.dsh-qa-modes__trigger{display:flex;align-items:center;gap:8px;max-width:100%;padding:4px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;text-align:left}
.dsh-qa-modes__trigger>span{min-width:0;overflow-wrap:anywhere}
.dsh-qa-modes__trigger>svg{flex:none;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-modes__trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-modes__trigger[aria-expanded=true]{border-color:var(--dsw-alias-label-secondary)}
.dsh-qa-modes__trigger:disabled{opacity:.5;cursor:default}
.dsh-qa-modes__trigger:focus-visible,.dsh-qa-modes__option input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsh-qa-accent));outline-offset:2px}
.dsh-qa-modes__popup{position:fixed;z-index:2147483005;box-sizing:border-box;width:min(350px,calc(100vw - 64px));max-height:calc(100dvh - 16px);overflow-y:auto;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv2)}
.dsh-qa-modes__heading{padding:8px 10px 0;font-size:14px;font-weight:600;line-height:20px}
.dsh-qa-modes__caption{margin:4px 10px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-qa-modes__option{display:flex;align-items:flex-start;gap:12px;padding:12px 10px;border-radius:8px;cursor:pointer}
.dsh-qa-modes__option:has(input:checked){background:color-mix(in srgb,var(--dsh-qa-accent) 10%,var(--dsw-alias-bg-layer-2))}
.dsh-qa-modes__option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-modes__text{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.dsh-qa-modes__name{font-size:14px;font-weight:600;line-height:20px}
.dsh-qa-modes__description{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-qa-modes__option input{flex:none;width:16px;height:16px;margin:2px 0 0;accent-color:var(--dsh-qa-accent)}
.dsh-qa-modes__tooltip{position:fixed;z-index:2147483006;display:block;box-sizing:border-box;width:max-content;max-width:min(330px,calc(100vw - 64px));max-height:calc(100dvh - 16px);padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv2);font-size:12px;font-weight:400;line-height:18px;white-space:pre-line;pointer-events:none;visibility:hidden;opacity:0;transition:opacity .2s cubic-bezier(.22,1,.36,1)}
.dsh-qa-modes__tooltip[data-active=true]{visibility:visible;opacity:1;transition-delay:.45s}
@media(pointer:coarse){.dsh-qa-modes__trigger{min-height:44px}.dsh-qa-modes__option{min-height:52px}.dsh-qa-modes__tooltip{display:none}}
@media(prefers-reduced-motion:reduce){.dsh-qa-modes__tooltip{transition:none}}
`;
