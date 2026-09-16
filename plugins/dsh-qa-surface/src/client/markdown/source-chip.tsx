import type { ReactNode } from "react";
import type { QaSource } from "../../types.js";
import { SourceIcon } from "../components/source-icon.js";
import {
  sourceFileName,
  type QaSourceRefs,
} from "../components/source-refs.js";

/** Inline source awareness handed down from the owning assistant message. */
export interface MarkdownSourceContext {
  readonly refs?: QaSourceRefs;
  /** Open a path-backed source in the sources drawer's detail view. */
  readonly onSourceOpen?: (source: QaSource) => void;
}

/**
 * One inline source footnote: a pill over the matched link or path with a
 * hover/focus preview card (title, target, snippet). A URL-backed source is
 * an anchor that opens right away; a path-backed one is a button whose click
 * the owner routes to the sources drawer.
 */
export function SourceChip({
  source,
  label,
  href,
  onOpen,
}: {
  readonly source: QaSource;
  readonly label: string;
  readonly href?: string;
  readonly onOpen?: (source: QaSource) => void;
}): ReactNode {
  const target = source.path ?? source.uri ?? source.title;
  const face = (
    <>
      <span className="dsh-qa-srcref__icon" data-kind={source.kind}>
        <SourceIcon kind={source.kind} />
      </span>
      <span className="dsh-qa-srcref__label">{label}</span>
      <span className="dsh-qa-srcref__card" aria-hidden="true">
        <span className="dsh-qa-srcref__card-title">
          <span className="dsh-qa-srcref__icon" data-kind={source.kind}>
            <SourceIcon kind={source.kind} />
          </span>
          {source.title || label}
        </span>
        <span className="dsh-qa-srcref__card-target">{target}</span>
        {source.snippet === undefined ? null : (
          <span className="dsh-qa-srcref__card-snippet">{source.snippet}</span>
        )}
      </span>
    </>
  );
  if (href !== undefined) {
    return (
      <a
        className="dsh-qa-srcref"
        data-kind={source.kind}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {face}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="dsh-qa-srcref"
      data-kind={source.kind}
      onClick={onOpen === undefined ? undefined : () => onOpen(source)}
    >
      {face}
    </button>
  );
}

/**
 * The chip a path-backed inline-code token earns, or undefined when the token
 * names no known source. A URL-backed token is a chip that opens right away.
 */
export function codeChip(
  value: string,
  context: MarkdownSourceContext,
): ReactNode | undefined {
  const source = context.refs?.resolvePath(value);
  if (source === undefined) return undefined;
  if (source.path === undefined) {
    return (
      <SourceChip
        source={source}
        label={source.title || value}
        href={safeHref(source.uri ?? "")}
      />
    );
  }
  if (context.onSourceOpen === undefined) return undefined;
  return (
    <SourceChip
      source={source}
      label={sourceFileName(source)}
      onOpen={context.onSourceOpen}
    />
  );
}

/** The chip a matched markdown link earns, or undefined when it matches none. */
export function linkChip(
  href: string,
  label: string,
  context: MarkdownSourceContext,
): ReactNode | undefined {
  const source = context.refs?.resolveUrl(href);
  if (source === undefined) return undefined;
  return (
    <SourceChip source={source} label={label || source.title} href={href} />
  );
}

/** http(s) destinations only; the renderer never emits another protocol. */
export function safeHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
