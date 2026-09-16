import { memo, useMemo } from "react";
import type { QaSource } from "../../types.js";
import type { QaSourceRefs } from "./source-refs.js";
import { renderMarkdown } from "../markdown/render.js";
import type { MarkdownSourceContext } from "../markdown/source-chip.js";

export type { MarkdownSourceContext } from "../markdown/source-chip.js";

/**
 * Assistant-visible Markdown. The grammar lives in `../markdown/`: blocks are
 * parsed once per text value, inline content is resolved per block, and a link
 * or inline-code token that names a source the owning message knows about
 * renders as a source chip instead of plain text.
 *
 * Memoized on the text value: stream updates re-render only the message whose
 * text actually changed, so committed history is never re-parsed.
 */
export const Markdown = memo(function Markdown({
  text,
  sourceRefs,
  onSourceOpen,
}: {
  readonly text: string;
  readonly sourceRefs?: QaSourceRefs;
  readonly onSourceOpen?: (source: QaSource) => void;
}) {
  const context = useMemo<MarkdownSourceContext>(
    () => ({
      ...(sourceRefs === undefined ? {} : { refs: sourceRefs }),
      ...(onSourceOpen === undefined ? {} : { onSourceOpen }),
    }),
    [sourceRefs, onSourceOpen],
  );
  const children = useMemo(
    () => renderMarkdown(text, context),
    [text, context],
  );
  return <div className="dsh-qa-md">{children}</div>;
});
