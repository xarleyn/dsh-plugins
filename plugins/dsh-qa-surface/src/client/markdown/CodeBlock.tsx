import { Fragment, memo, useMemo } from "react";
import type { ReactNode } from "react";
import { useCopyAction } from "../clipboard.js";
import { CopyHint } from "../components/copy-hint.js";
import { highlightLines } from "./highlight.js";

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
  const copy = useCopyAction(code);
  return (
    <div className="dsh-qa-md-code" data-testid="qa-md-code">
      <div className="dsh-qa-md-code__banner" data-testid="qa-md-code-banner">
        <span className="dsh-qa-md-code__lang" data-testid="qa-md-code-lang">
          {lang ?? ""}
        </span>
        {copy.impossible ? (
          <CopyHint testId="qa-md-code-copy-hint" />
        ) : (
          <>
            <button
              type="button"
              className="dsh-qa-md-code__copy"
              data-testid="qa-md-code-copy"
              onClick={copy.copy}
              aria-label={copy.copied ? "Скопировано" : "Копировать код"}
            >
              {copy.copied ? "Скопировано" : "Копировать"}
            </button>
            {copy.refused ? <CopyHint testId="qa-md-code-copy-hint" /> : null}
          </>
        )}
      </div>
      <pre tabIndex={0} data-testid="qa-md-code-pre">
        <code data-language={lang} data-testid="qa-md-code-content">
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
                    data-testid="qa-md-code-token"
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
    <svg
      className="dsh-qa-md-link-icon"
      data-testid="qa-md-link-icon"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5.1" />
      <path d="M7 1.9c1.6 1.7 1.6 8.5 0 10.2M7 1.9c-1.6 1.7-1.6 8.5 0 10.2M1.9 7h10.2" />
    </svg>
  );
}
