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
 * `streaming` says the text is a frame of a live answer, so the block the
 * answer stopped inside is held rather than rendered as settled: an open `$$`
 * fence shows the TeX being written instead of its dollars, and a table leaves
 * a half-typed row out until the row is whole.
 *
 * Memoized on the text value: stream updates re-render only the message whose
 * text actually changed, so committed history is never re-parsed.
 */
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
  sourceRefs,
  onSourceOpen,
}: {
  readonly text: string;
  /** Whether the text is still growing; a settled answer renders in full. */
  readonly streaming?: boolean;
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
    () => renderMarkdown(text, context, { streaming }),
    [text, context, streaming],
  );
  return <div className="dsh-qa-md">{children}</div>;
});
