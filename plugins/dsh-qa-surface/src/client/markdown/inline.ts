/**
 * GFM inline grammar for the chat renderer: code spans, emphasis, links,
 * images, autolinks, TeX math, footnotes, and the two line-break flavors.
 * Emphasis follows the CommonMark intent (a closer must match its opener's
 * delimiter run, `_` never opens inside a word) rather than the full
 * delimiter-stack algorithm — the shapes this grammar cannot express are the
 * pathological ones, and they degrade to literal text instead of mangling the
 * sentence. Math follows the Host transcript: `$…$` and `$$…$$` spans, with
 * maximal-munch dollar runs and whitespace padding stripped only when both
 * ends carry it.
 */

/** One inline node; `children` nodes nest. */
export type MarkdownInline =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "softbreak" }
  | { readonly kind: "break" }
  | { readonly kind: "code"; readonly value: string }
  | {
      readonly kind: "strong" | "em" | "del";
      readonly children: readonly MarkdownInline[];
    }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly children: readonly MarkdownInline[];
    }
  | { readonly kind: "image"; readonly src: string; readonly alt: string }
  | { readonly kind: "inlineMath"; readonly value: string }
  | { readonly kind: "footnoteRef"; readonly id: string };

/** Nesting ceiling for inline containers. */
const MAX_INLINE_DEPTH = 8;
/** Scheme prefix of an autolink or a bare link literal. */
const AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*)>/u;
const EMAIL_AUTOLINK = /^<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/u;
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<>`[\]]+/u;
const ESCAPABLE = /[!-/:-@[-`{-~]/u;
/** Characters a bare URL may not start right after. */
const URL_BOUNDARY = /[\s([{<«„"'*_~]/u;
const TRAILING_PUNCTUATION = /[.,;:!?…]+$/u;
/** A footnote label may not carry whitespace or brackets. */
const FOOTNOTE_LABEL = /^[^\]\s[]+$/u;

/** The reference targets one inline pass resolves against. */
export interface InlineTargets {
  /** Link/image definitions by upper-cased identifier. */
  readonly definitions: ReadonlyMap<string, string>;
  /** Footnote identifiers that have a definition, by upper-cased label. */
  readonly footnotes: ReadonlyMap<string, unknown>;
}

const NO_TARGETS: InlineTargets = {
  definitions: new Map(),
  footnotes: new Map(),
};

/**
 * Parse the inline content of one leaf block.
 * @param text - Raw inline Markdown, newlines included.
 * @param targets - The definitions and footnotes this pass resolves against.
 * @param depth - Inline nesting depth.
 * @returns The inline nodes in document order.
 */
export function parseInline(
  text: string,
  targets: ReadonlyMap<string, string> | InlineTargets,
  depth = 0,
): MarkdownInline[] {
  const { definitions, footnotes } = isTargets(targets)
    ? targets
    : { definitions: targets, footnotes: NO_TARGETS.footnotes };
  if (depth > MAX_INLINE_DEPTH) return [{ kind: "text", value: text }];
  const nodes: MarkdownInline[] = [];
  // The delimiter index is built once per pass, on the first emphasis run —
  // text without emphasis never pays for it.
  let delimiterCache: DelimiterIndex | undefined;
  const delimiters = (): DelimiterIndex =>
    (delimiterCache ??= scanDelimiters(text));
  let buffer = "";
  const flush = (): void => {
    if (buffer !== "") {
      nodes.push({ kind: "text", value: buffer });
      buffer = "";
    }
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";

    if (char === "\n") {
      // A hard break is two trailing spaces or a backslash; anything else is a
      // soft break, which the stylesheet collapses exactly as CommonMark does.
      if (buffer.endsWith("\\")) {
        buffer = buffer.slice(0, -1);
        flush();
        nodes.push({ kind: "break" });
      } else if (/ {2,}$/u.test(buffer)) {
        buffer = buffer.replace(/ +$/u, "");
        flush();
        nodes.push({ kind: "break" });
      } else {
        buffer = buffer.replace(/ +$/u, "");
        flush();
        nodes.push({ kind: "softbreak" });
      }
      index += 1;
      continue;
    }

    if (char === "\\") {
      const next = text[index + 1] ?? "";
      if (next !== "" && ESCAPABLE.test(next)) {
        buffer += next;
        index += 2;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === "`") {
      const span = readCodeSpan(text, index);
      if (span !== undefined) {
        flush();
        nodes.push({ kind: "code", value: span.value });
        index = span.end;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === "$") {
      const math = readMathSpan(text, index);
      if (math !== undefined) {
        flush();
        nodes.push({ kind: "inlineMath", value: math.value });
        index = math.end;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === "[" && text[index + 1] === "^") {
      const footnote = readFootnoteRef(text, index, footnotes);
      if (footnote !== undefined) {
        flush();
        nodes.push({ kind: "footnoteRef", id: footnote.id });
        index = footnote.end;
        continue;
      }
    }

    if (char === "<") {
      const autolink = AUTOLINK.exec(text.slice(index));
      const email =
        autolink === null ? EMAIL_AUTOLINK.exec(text.slice(index)) : null;
      const match = autolink ?? email;
      if (match !== null) {
        flush();
        const target = match[1] ?? "";
        nodes.push({
          kind: "link",
          href: email === null ? target : `mailto:${target}`,
          children: [{ kind: "text", value: target }],
        });
        index += match[0].length;
        continue;
      }
      // Raw HTML is not a construct here: the tag stays literal text.
      buffer += char;
      index += 1;
      continue;
    }

    if (char === "!" && text[index + 1] === "[") {
      const target = readInlineTarget(text, index + 1, definitions);
      if (target !== undefined) {
        flush();
        nodes.push({ kind: "image", src: target.href, alt: target.label });
        index = target.end;
        continue;
      }
    }

    if (char === "[") {
      const target = readInlineTarget(text, index, definitions);
      if (target !== undefined) {
        flush();
        nodes.push({
          kind: "link",
          href: target.href,
          children: parseInline(
            target.label,
            { definitions, footnotes },
            depth + 1,
          ),
        });
        index = target.end;
        continue;
      }
    }

    if (char === "*" || char === "_" || char === "~") {
      const emphasis = readEmphasis(
        text,
        index,
        definitions,
        footnotes,
        depth,
        delimiters,
      );
      if (emphasis !== undefined) {
        flush();
        nodes.push(emphasis.node);
        index = emphasis.end;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    const boundary = index === 0 || URL_BOUNDARY.test(text[index - 1] ?? "");
    if (boundary && (char === "h" || char === "w")) {
      const url = BARE_URL.exec(text.slice(index));
      if (url !== null) {
        const raw = url[0].replace(TRAILING_PUNCTUATION, "");
        flush();
        nodes.push({
          kind: "link",
          href: raw.startsWith("www.") ? `http://${raw}` : raw,
          children: [{ kind: "text", value: raw }],
        });
        index += raw.length;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }
  flush();
  return nodes;
}

/** A code span's payload once its closing run is found. */
function readCodeSpan(
  text: string,
  start: number,
): { readonly value: string; readonly end: number } | undefined {
  let length = 0;
  while (text[start + length] === "`") length += 1;
  const opener = "`".repeat(length);
  const close = text.indexOf(opener, start + length);
  if (close < 0) return undefined;
  // A longer run of backticks is not this span's closer.
  if (text[close + length] === "`") return undefined;
  const raw = text.slice(start + length, close).replace(/\n/gu, " ");
  const padded = raw.length > 2 && raw.startsWith(" ") && raw.endsWith(" ");
  return { value: padded ? raw.slice(1, -1) : raw, end: close + length };
}

/** Whether the argument is the full target set rather than bare definitions. */
function isTargets(
  value: ReadonlyMap<string, string> | InlineTargets,
): value is InlineTargets {
  return "footnotes" in value;
}

/**
 * One `$…$` or `$$…$$` span, or nothing when no equal-length dollar run
 * closes it. The opener run is maximal (`$$$$` is a four-dollar opener, not
 * two), the closer is the next run of exactly that length, and surrounding
 * whitespace is stripped only when both ends carry it and data sits between —
 * the shapes the Host's grammar reads. A backslash inside the span is TeX
 * data, so `\$` does not hide a closer.
 */
function readMathSpan(
  text: string,
  start: number,
): { readonly value: string; readonly end: number } | undefined {
  let length = 1;
  while (text[start + length] === "$") length += 1;
  let index = start + length;
  while (index < text.length) {
    if (text[index] !== "$") {
      index += 1;
      continue;
    }
    let run = 1;
    while (text[index + run] === "$") run += 1;
    if (run === length) {
      const raw = text.slice(start + length, index);
      const padded =
        raw.length >= 2 &&
        isSpaceOrLineEnding(raw[0] ?? "") &&
        isSpaceOrLineEnding(raw[raw.length - 1] ?? "") &&
        /\S/u.test(raw);
      return { value: padded ? raw.slice(1, -1) : raw, end: index + run };
    }
    index += run;
  }
  return undefined;
}

/** A space or a line ending — the two characters math padding may carry. */
function isSpaceOrLineEnding(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r";
}

/**
 * A `[^label]` reference the document defines, or nothing — an undefined
 * label stays literal text, as GitHub renders it.
 */
function readFootnoteRef(
  text: string,
  start: number,
  footnotes: ReadonlyMap<string, unknown>,
): { readonly id: string; readonly end: number } | undefined {
  const close = text.indexOf("]", start + 2);
  if (close < 0) return undefined;
  const label = text.slice(start + 2, close);
  if (!FOOTNOTE_LABEL.test(label) || !footnotes.has(label.toUpperCase())) {
    return undefined;
  }
  return { id: label, end: close + 1 };
}

/** The closing bracket of a `[label]`, honoring nesting and escapes. */
function readLabel(
  text: string,
  start: number,
): { readonly label: string; readonly end: number } | undefined {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return { label: text.slice(start + 1, index), end: index + 1 };
      }
    }
    index += 1;
  }
  return undefined;
}

/** A `(destination "title")` tail, destination unescaped. */
function readDestination(
  text: string,
  start: number,
): { readonly href: string; readonly end: number } | undefined {
  if (text[start] !== "(") return undefined;
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        const inner = text.slice(start + 1, index);
        const href =
          /^(<[^>]*>|'[^']*'|"[^"]*"|\S*)/u.exec(inner.trim())?.[1] ?? "";
        const bare = href.replace(/^<|>$/gu, "");
        if (bare === "") return undefined;
        return {
          href: bare.replace(/\\([!-/:-@[-`{-~])/gu, "$1"),
          end: index + 1,
        };
      }
    }
    index += 1;
  }
  return undefined;
}

/**
 * Resolve a link or image starting at `start` (the `[`): an inline
 * destination, a reference the block pass collected, or nothing.
 */
function readInlineTarget(
  text: string,
  start: number,
  definitions: ReadonlyMap<string, string>,
):
  | { readonly label: string; readonly href: string; readonly end: number }
  | undefined {
  const label = readLabel(text, start);
  if (label === undefined) return undefined;
  const inline = readDestination(text, label.end);
  if (inline !== undefined) {
    return { label: label.label, href: inline.href, end: inline.end };
  }
  if (text[label.end] === "[") {
    const reference = readLabel(text, label.end);
    if (reference === undefined) return undefined;
    const id = (
      reference.label === "" ? label.label : reference.label
    ).toUpperCase();
    const href = definitions.get(id);
    if (href === undefined) return undefined;
    return { label: label.label, href, end: reference.end };
  }
  const shortcut = definitions.get(label.label.toUpperCase());
  if (shortcut === undefined) return undefined;
  return { label: label.label, href: shortcut, end: label.end };
}

/**
 * One maximal `*`/`_`/`~` run a closer search may consult. Runs are collected
 * with the forward scan's own stepping (escapes and code spans alike), so a
 * run the scan skips never appears here either.
 */
interface DelimiterRun {
  readonly index: number;
  readonly char: string;
  readonly length: number;
}

/** The run layout of one inline pass, plus its closer lookup. */
interface DelimiterIndex {
  readonly runs: readonly DelimiterRun[];
  /** First qualifying closer position per `char`+size key, ascending. */
  readonly closers: ReadonlyMap<string, readonly number[]>;
}

/**
 * Collect the delimiter runs of `text` in one pass. A forward closer scan
 * meets each run at exactly one position: its first char — unless a blank
 * precedes the run, where the scan steps in and examines the second char
 * against the run shortened by one. Recording that one entry position per run
 * (with the `_`-in-a-word rejection applied) turns every later closer lookup
 * into a binary search instead of a rescan of the tail. Math spans are
 * skipped the way code spans are: `*` inside `$…$` is TeX, not emphasis.
 */
function scanDelimiters(text: string): DelimiterIndex {
  const runs: DelimiterRun[] = [];
  const closers = new Map<string, number[]>();
  let index = 0;
  while (index < text.length) {
    const current = text[index] ?? "";
    if (current === "\\") {
      index += 2;
      continue;
    }
    if (current === "`") {
      const span = readCodeSpan(text, index);
      if (span !== undefined) {
        index = span.end;
        continue;
      }
    }
    if (current === "$") {
      const span = readMathSpan(text, index);
      if (span !== undefined) {
        index = span.end;
        continue;
      }
    }
    if (current === "*" || current === "_" || current === "~") {
      let length = 0;
      while (text[index + length] === current) length += 1;
      runs.push({ index, char: current, length });
      const afterBlank =
        index > 0 && (text[index - 1] === " " || text[index - 1] === "\n");
      const position = afterBlank ? index + 1 : index;
      const size = afterBlank ? length - 1 : length;
      const openable = current === "~" ? size === 2 : size >= 1 && size <= 3;
      const inWord =
        current === "_" && /[\w]/u.test(text[index + length] ?? "");
      if (openable && !inWord) {
        const key = `${current}${size}`;
        closers.set(key, [...(closers.get(key) ?? []), position]);
      }
      index += length;
      continue;
    }
    index += 1;
  }
  return { runs, closers };
}

/** The first closer candidate at or after `start`, or nothing. */
function findCloser(
  delimiters: DelimiterIndex,
  start: number,
  char: string,
  length: number,
): number | undefined {
  const candidates = delimiters.closers.get(`${char}${length}`);
  if (candidates === undefined) return undefined;
  let lo = 0;
  let hi = candidates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((candidates[mid] ?? Number.POSITIVE_INFINITY) < start) lo = mid + 1;
    else hi = mid;
  }
  return candidates[lo];
}

/** The delimiter run covering `start`, or undefined between runs. */
function coveringRun(
  runs: readonly DelimiterRun[],
  start: number,
): DelimiterRun | undefined {
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((runs[mid]?.index ?? Number.POSITIVE_INFINITY) <= start) lo = mid + 1;
    else hi = mid;
  }
  const run = runs[lo - 1];
  return run !== undefined &&
    run.index <= start &&
    start < run.index + run.length
    ? run
    : undefined;
}

/** One emphasis run, or the literal fallback when it never closes. */
function readEmphasis(
  text: string,
  start: number,
  definitions: ReadonlyMap<string, string>,
  footnotes: ReadonlyMap<string, unknown>,
  depth: number,
  delimiters: () => DelimiterIndex,
): { readonly node: MarkdownInline; readonly end: number } | undefined {
  const char = text[start] ?? "";
  // The run covering `start` is already known to the index; counting here
  // would redo the tail of a long run at every position inside it.
  const run = coveringRun(delimiters().runs, start);
  let length = 0;
  if (run !== undefined && run.char === char) {
    length = run.length - (start - run.index);
  } else {
    while (text[start + length] === char) length += 1;
  }
  if (char === "~" && length !== 2) return undefined;
  if (char !== "~" && length > 3) return undefined;
  // `_` opens only at a word boundary; `*` and `~~` only before content.
  if (char === "_" && /\w/u.test(text[start - 1] ?? "")) return undefined;
  const after = text[start + length] ?? "";
  if (after === "" || after === " " || after === "\n") return undefined;

  const close = findCloser(delimiters(), start + length, char, length);
  if (close === undefined) return undefined;
  const children = parseInline(
    text.slice(start + length, close),
    { definitions, footnotes },
    depth + 1,
  );
  const node: MarkdownInline =
    char === "~"
      ? { kind: "del", children }
      : length === 1
        ? { kind: "em", children }
        : length === 2
          ? { kind: "strong", children }
          : { kind: "em", children: [{ kind: "strong", children }] };
  return { node, end: close + length };
}
