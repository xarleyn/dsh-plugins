import { Fragment, memo, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { highlightLines } from "./highlight.js";
import { useTransientFlag } from "./use-transient-flag.js";

/** Copied-label window: long enough to read, short enough to not stick. */
const COPIED_MS = 1200;

/**
 * One fenced code block: the language banner, a copy button, and the code
 * itself. Highlighting is our own scanner (see `highlight.ts`) — the fence is
 * memoized on its source and info string, so a streaming append re-tokenizes
 * only the fence that grew.
 */
export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
}: {
  readonly code: string;
  readonly lang?: string;
}) {
  const lines = useMemo(() => highlightLines(code, lang), [code, lang]);
  const { on: copied, pulse: pulseCopied } = useTransientFlag(COPIED_MS);
  const onCopy = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) return;
    clipboard.writeText(code).then(pulseCopied, () => undefined);
  }, [code, pulseCopied]);
  return (
    <div className="dsh-qa-md-code">
      <div className="dsh-qa-md-code__banner">
        <span className="dsh-qa-md-code__lang">{lang ?? ""}</span>
        <button
          type="button"
          className="dsh-qa-md-code__copy"
          onClick={onCopy}
          aria-label={copied ? "Скопировано" : "Копировать код"}
        >
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
      <pre tabIndex={0}>
        <code data-language={lang}>
          {lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 ? "\n" : null}
              {line.map((span, spanIndex) =>
                span.cls === undefined ? (
                  <Fragment key={spanIndex}>{span.text}</Fragment>
                ) : (
                  <span
                    key={spanIndex}
                    className="dsh-qa-md-tok"
                    data-tok={span.cls}
                  >
                    {span.text}
                  </span>
                ),
              )}
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
});

/** The globe an external link wears, drawn like the surface's other icons. */
export function LinkGlyph(): ReactNode {
  return (
    <svg className="dsh-qa-md-link-icon" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.1" />
      <path d="M7 1.9c1.6 1.7 1.6 8.5 0 10.2M7 1.9c-1.6 1.7-1.6 8.5 0 10.2M1.9 7h10.2" />
    </svg>
  );
}
