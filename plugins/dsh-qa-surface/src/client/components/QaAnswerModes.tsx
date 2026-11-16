import { useEffect, useId, useRef, useState } from "react";
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

export function QaAnswerModes(props: {
  readonly modes: readonly QaAnswerMode[];
  readonly disabled: boolean;
  readonly onChange: (modes: readonly QaAnswerMode[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const owner = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const label = props.modes
    .map((mode) => QA_ANSWER_MODE_NAMES[mode])
    .join(" + ");
  const tooltip = props.modes
    .map(
      (mode) => `${QA_ANSWER_MODE_NAMES[mode]}: ${qaAnswerModeTooltip(mode)}`,
    )
    .join("\n\n");

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !owner.current?.contains(event.target)
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
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <span className="dsh-qa-modes__tooltip-owner">
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
                owner.current
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
        <span id={`${id}-tip`} className="dsh-qa-modes__tooltip" role="tooltip">
          {tooltip}
        </span>
      </span>
      {open ? (
        <div
          id={`${id}-list`}
          className="dsh-qa-modes__popup"
          role="group"
          aria-label="Режимы ответа"
        >
          <div className="dsh-qa-modes__heading">Режимы ответа</div>
          <p className="dsh-qa-modes__caption">Можно выбрать несколько</p>
          {MODES.map((mode) => (
            <label
              key={mode}
              className="dsh-qa-modes__option dsh-qa-modes__tooltip-owner"
            >
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
              <span
                id={`${id}-${mode}-tip`}
                className="dsh-qa-modes__tooltip"
                role="tooltip"
              >
                {qaAnswerModeTooltip(mode)}
              </span>
            </label>
          ))}
          {notice ? (
            <p className="dsh-qa-modes__caption" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
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
.dsh-qa-modes__popup{position:absolute;bottom:calc(100% + 10px);right:0;z-index:30;width:min(350px,calc(100vw - 64px));padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv2)}
.dsh-qa-modes__heading{padding:8px 10px 0;font-size:14px;font-weight:600;line-height:20px}
.dsh-qa-modes__caption{margin:4px 10px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-qa-modes__option{display:flex;align-items:flex-start;gap:12px;padding:12px 10px;border-radius:8px;cursor:pointer}
.dsh-qa-modes__option:has(input:checked){background:color-mix(in srgb,var(--dsh-qa-accent) 10%,var(--dsw-alias-bg-layer-2))}
.dsh-qa-modes__option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-qa-modes__text{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.dsh-qa-modes__name{font-size:14px;font-weight:600;line-height:20px}
.dsh-qa-modes__description{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-qa-modes__option input{flex:none;width:16px;height:16px;margin:2px 0 0;accent-color:var(--dsh-qa-accent)}
.dsh-qa-modes__tooltip{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;display:block;width:max-content;max-width:min(330px,calc(100vw - 64px));padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv2);font-size:12px;font-weight:400;line-height:18px;white-space:pre-line;pointer-events:none;visibility:hidden;opacity:0;transition:opacity .2s cubic-bezier(.22,1,.36,1)}
.dsh-qa-modes__tooltip-owner:hover>.dsh-qa-modes__tooltip,.dsh-qa-modes__tooltip-owner:focus-within>.dsh-qa-modes__tooltip{visibility:visible;opacity:1;transition-delay:.45s}
.dsh-qa-modes:has(.dsh-qa-modes__popup)>.dsh-qa-modes__tooltip-owner>.dsh-qa-modes__tooltip{visibility:hidden;opacity:0}
@media(pointer:coarse){.dsh-qa-modes__trigger{min-height:44px}.dsh-qa-modes__option{min-height:52px}.dsh-qa-modes__tooltip{display:none}}
@media(max-width:520px){.dsh-qa-modes__popup,.dsh-qa-modes>.dsh-qa-modes__tooltip-owner>.dsh-qa-modes__tooltip{right:-40px}}
@media(prefers-reduced-motion:reduce){.dsh-qa-modes__tooltip{transition:none}}
`;
