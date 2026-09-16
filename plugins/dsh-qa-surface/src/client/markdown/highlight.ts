/**
 * The chat renderer's syntax highlighter: a small tokenizer over per-language
 * keyword/comment/string tables, not a grammar engine. The original UI runs
 * shiki; its grammar modules alone cost ~1.6 MB, which a self-contained plugin
 * bundle cannot carry, so this scanner covers the shapes that carry meaning in
 * an answer — comments, strings, numbers, keywords — and leaves the rest of the
 * line in the foreground color. Colors come from the host theme's
 * `--shiki-token-*` custom properties, so a fenced block here matches a fenced
 * block in the assistant's own transcript in both light and dark themes.
 *
 * An unknown or absent language renders plain: never an error, never a guess.
 */

/** Token categories the stylesheet colors. */
export type HighlightClass =
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "constant"
  | "meta"
  | "tag"
  | "attr"
  | "key"
  | "insert"
  | "delete"
  | "hunk";

/** One colored run of a code line. */
export interface HighlightSpan {
  readonly text: string;
  readonly cls?: HighlightClass;
}

/** One code line as colored runs. */
export type HighlightLine = readonly HighlightSpan[];

/** One string-delimiter rule. */
interface StringRule {
  readonly open: string;
  readonly close: string;
  /** Backslash escapes the next character. */
  readonly escape?: boolean;
  /** A doubled closing delimiter escapes it (C# verbatim strings, SQL). */
  readonly doubled?: boolean;
  /** The string may span lines. */
  readonly multiline?: boolean;
}

/** One language's lexical tables. */
interface LanguageSpec {
  readonly keywords?: readonly string[];
  readonly caseInsensitive?: boolean;
  readonly lineComments?: readonly string[];
  readonly blockComment?: readonly [string, string];
  readonly strings?: readonly StringRule[];
  /** `key:`/`key=` at a value position takes the key color. */
  readonly keys?: boolean;
  /** `@Name` takes the meta color (decorators, annotations, attributes). */
  readonly annotations?: boolean;
  /** `#…` at a line start takes the meta color (preprocessor directives). */
  readonly directives?: boolean;
  /** Markup: tags, attributes, comments. */
  readonly markup?: boolean;
  /** Unified diff: per-line roles. */
  readonly diff?: boolean;
}

/** Double and single quotes that end at the line they start on. */
const QUOTES: readonly StringRule[] = [
  { open: '"', close: '"', escape: true },
  { open: "'", close: "'", escape: true },
];

const SQL_KEYWORDS = [
  "add",
  "all",
  "alter",
  "and",
  "any",
  "as",
  "asc",
  "begin",
  "between",
  "by",
  "case",
  "cast",
  "check",
  "column",
  "commit",
  "constraint",
  "create",
  "cross",
  "default",
  "delete",
  "desc",
  "distinct",
  "drop",
  "else",
  "end",
  "exists",
  "foreign",
  "from",
  "full",
  "group",
  "having",
  "if",
  "in",
  "index",
  "inner",
  "insert",
  "into",
  "is",
  "join",
  "key",
  "left",
  "like",
  "limit",
  "not",
  "null",
  "offset",
  "on",
  "or",
  "order",
  "outer",
  "primary",
  "references",
  "returning",
  "right",
  "rollback",
  "select",
  "set",
  "table",
  "then",
  "transaction",
  "union",
  "unique",
  "update",
  "values",
  "view",
  "when",
  "where",
  "with",
];

const SHELL_KEYWORDS = [
  "case",
  "cd",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "exit",
  "export",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "local",
  "readonly",
  "return",
  "set",
  "source",
  "then",
  "unset",
  "until",
  "while",
];

const LANGUAGE_SPECS: ReadonlyMap<string, LanguageSpec> = new Map(
  Object.entries({
    csharp: {
      keywords: [
        "abstract",
        "as",
        "async",
        "await",
        "base",
        "bool",
        "break",
        "byte",
        "case",
        "catch",
        "char",
        "checked",
        "class",
        "const",
        "continue",
        "decimal",
        "default",
        "delegate",
        "do",
        "double",
        "dynamic",
        "else",
        "enum",
        "event",
        "explicit",
        "extern",
        "finally",
        "fixed",
        "float",
        "for",
        "foreach",
        "get",
        "goto",
        "if",
        "implicit",
        "in",
        "init",
        "int",
        "interface",
        "internal",
        "is",
        "lock",
        "long",
        "namespace",
        "new",
        "object",
        "operator",
        "out",
        "override",
        "params",
        "private",
        "protected",
        "public",
        "readonly",
        "record",
        "ref",
        "return",
        "sbyte",
        "sealed",
        "set",
        "short",
        "sizeof",
        "stackalloc",
        "static",
        "string",
        "struct",
        "switch",
        "this",
        "throw",
        "try",
        "typeof",
        "uint",
        "ulong",
        "unchecked",
        "unsafe",
        "ushort",
        "using",
        "value",
        "var",
        "virtual",
        "void",
        "volatile",
        "when",
        "where",
        "while",
        "yield",
      ],
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: [
        { open: '@"', close: '"', doubled: true, multiline: true },
        { open: '$"', close: '"', escape: true },
        ...QUOTES,
      ],
      annotations: true,
      directives: true,
    },
    javascript: {
      keywords: [
        "as",
        "async",
        "await",
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "debugger",
        "default",
        "delete",
        "do",
        "else",
        "export",
        "extends",
        "finally",
        "for",
        "from",
        "function",
        "get",
        "if",
        "import",
        "in",
        "instanceof",
        "let",
        "new",
        "of",
        "return",
        "set",
        "static",
        "super",
        "switch",
        "this",
        "throw",
        "try",
        "typeof",
        "var",
        "void",
        "while",
        "with",
        "yield",
      ],
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: [
        ...QUOTES,
        { open: "`", close: "`", escape: true, multiline: true },
      ],
      annotations: true,
    },
    json: {
      lineComments: ["//"],
      strings: QUOTES,
      keys: true,
    },
    java: {
      keywords: [
        "abstract",
        "assert",
        "boolean",
        "break",
        "byte",
        "case",
        "catch",
        "char",
        "class",
        "const",
        "continue",
        "default",
        "do",
        "double",
        "else",
        "enum",
        "extends",
        "final",
        "finally",
        "float",
        "for",
        "goto",
        "if",
        "implements",
        "import",
        "instanceof",
        "int",
        "interface",
        "long",
        "native",
        "new",
        "package",
        "private",
        "protected",
        "public",
        "record",
        "return",
        "sealed",
        "short",
        "static",
        "strictfp",
        "super",
        "switch",
        "synchronized",
        "this",
        "throw",
        "throws",
        "transient",
        "try",
        "var",
        "void",
        "volatile",
        "while",
      ],
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: QUOTES,
      annotations: true,
    },
    kotlin: {
      keywords: [
        "as",
        "break",
        "class",
        "companion",
        "const",
        "constructor",
        "continue",
        "data",
        "do",
        "else",
        "enum",
        "expect",
        "external",
        "final",
        "for",
        "fun",
        "get",
        "if",
        "in",
        "init",
        "interface",
        "internal",
        "is",
        "lateinit",
        "object",
        "open",
        "operator",
        "out",
        "override",
        "package",
        "private",
        "protected",
        "public",
        "return",
        "sealed",
        "set",
        "super",
        "suspend",
        "tailrec",
        "this",
        "throw",
        "try",
        "typealias",
        "val",
        "var",
        "vararg",
        "when",
        "where",
        "while",
      ],
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: [{ open: '"""', close: '"""', multiline: true }, ...QUOTES],
      annotations: true,
    },
    go: {
      keywords: [
        "break",
        "case",
        "chan",
        "const",
        "continue",
        "default",
        "defer",
        "else",
        "fallthrough",
        "for",
        "func",
        "go",
        "goto",
        "if",
        "import",
        "interface",
        "map",
        "package",
        "range",
        "return",
        "select",
        "struct",
        "switch",
        "type",
        "var",
      ],
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: [{ open: "`", close: "`", multiline: true }, ...QUOTES],
    },
    rust: {
      keywords: [
        "as",
        "async",
        "await",
        "break",
        "const",
        "continue",
        "crate",
        "dyn",
        "else",
        "enum",
        "extern",
        "fn",
        "for",
        "if",
        "impl",
        "in",
        "let",
        "loop",
        "match",
        "mod",
        "move",
        "mut",
        "pub",
        "ref",
        "return",
        "self",
        "static",
        "struct",
        "super",
        "trait",
        "type",
        "unsafe",
        "use",
        "where",
        "while",
      ],
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: QUOTES,
      annotations: true,
    },
    c: {
      keywords: [
        "auto",
        "break",
        "case",
        "char",
        "const",
        "continue",
        "default",
        "do",
        "double",
        "else",
        "enum",
        "extern",
        "float",
        "for",
        "goto",
        "if",
        "inline",
        "int",
        "long",
        "register",
        "restrict",
        "return",
        "short",
        "signed",
        "sizeof",
        "static",
        "struct",
        "switch",
        "typedef",
        "union",
        "unsigned",
        "void",
        "volatile",
        "while",
      ],
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: QUOTES,
      directives: true,
    },
    cpp: {
      keywords: [
        "alignas",
        "auto",
        "bool",
        "break",
        "case",
        "catch",
        "char",
        "class",
        "const",
        "constexpr",
        "continue",
        "decltype",
        "default",
        "delete",
        "do",
        "double",
        "else",
        "enum",
        "explicit",
        "extern",
        "false",
        "float",
        "for",
        "friend",
        "goto",
        "if",
        "inline",
        "int",
        "long",
        "mutable",
        "namespace",
        "new",
        "noexcept",
        "nullptr",
        "operator",
        "override",
        "private",
        "protected",
        "public",
        "register",
        "return",
        "short",
        "signed",
        "sizeof",
        "static",
        "struct",
        "switch",
        "template",
        "this",
        "throw",
        "try",
        "typedef",
        "typename",
        "union",
        "unsigned",
        "using",
        "virtual",
        "void",
        "volatile",
        "while",
      ],
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: QUOTES,
      directives: true,
    },
    python: {
      keywords: [
        "and",
        "as",
        "assert",
        "async",
        "await",
        "break",
        "class",
        "continue",
        "def",
        "del",
        "elif",
        "else",
        "except",
        "finally",
        "for",
        "from",
        "global",
        "if",
        "import",
        "in",
        "is",
        "lambda",
        "nonlocal",
        "not",
        "or",
        "pass",
        "raise",
        "return",
        "try",
        "while",
        "with",
        "yield",
      ],
      lineComments: ["#"],
      strings: [
        { open: '"""', close: '"""', escape: true, multiline: true },
        { open: "'''", close: "'''", escape: true, multiline: true },
        { open: 'f"', close: '"', escape: true },
        { open: "f'", close: "'", escape: true },
        ...QUOTES,
      ],
      annotations: true,
    },
    ruby: {
      keywords: [
        "alias",
        "and",
        "begin",
        "break",
        "case",
        "class",
        "def",
        "defined",
        "do",
        "else",
        "elsif",
        "end",
        "ensure",
        "for",
        "if",
        "in",
        "module",
        "next",
        "not",
        "or",
        "redo",
        "require",
        "rescue",
        "retry",
        "return",
        "self",
        "super",
        "then",
        "undef",
        "unless",
        "until",
        "when",
        "while",
        "yield",
      ],
      lineComments: ["#"],
      strings: QUOTES,
      annotations: true,
    },
    php: {
      keywords: [
        "abstract",
        "array",
        "as",
        "break",
        "case",
        "catch",
        "class",
        "clone",
        "const",
        "continue",
        "declare",
        "default",
        "do",
        "echo",
        "else",
        "elseif",
        "enum",
        "extends",
        "final",
        "finally",
        "fn",
        "for",
        "foreach",
        "function",
        "global",
        "if",
        "implements",
        "include",
        "instanceof",
        "interface",
        "isset",
        "namespace",
        "new",
        "print",
        "private",
        "protected",
        "public",
        "readonly",
        "require",
        "return",
        "static",
        "switch",
        "throw",
        "trait",
        "try",
        "unset",
        "use",
        "while",
        "yield",
      ],
      lineComments: ["//", "#"],
      blockComment: ["/*", "*/"],
      strings: QUOTES,
    },
    swift: {
      keywords: [
        "associatedtype",
        "case",
        "catch",
        "class",
        "defer",
        "deinit",
        "do",
        "else",
        "enum",
        "extension",
        "fileprivate",
        "for",
        "func",
        "guard",
        "if",
        "import",
        "in",
        "init",
        "internal",
        "let",
        "open",
        "operator",
        "private",
        "protocol",
        "public",
        "repeat",
        "return",
        "self",
        "static",
        "struct",
        "subscript",
        "switch",
        "throw",
        "throws",
        "try",
        "typealias",
        "var",
        "where",
        "while",
      ],
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: [{ open: '"""', close: '"""', multiline: true }, ...QUOTES],
      annotations: true,
    },
    sql: {
      keywords: SQL_KEYWORDS,
      caseInsensitive: true,
      lineComments: ["--"],
      blockComment: ["/*", "*/"],
      strings: [{ open: "'", close: "'", doubled: true, multiline: true }],
    },
    shell: {
      keywords: SHELL_KEYWORDS,
      lineComments: ["#"],
      strings: [
        { open: '"', close: '"', escape: true, multiline: true },
        { open: "'", close: "'", multiline: true },
      ],
    },
    yaml: { lineComments: ["#"], strings: QUOTES, keys: true },
    toml: { lineComments: ["#"], strings: QUOTES, keys: true },
    ini: { lineComments: [";", "#"], strings: QUOTES, keys: true },
    css: { blockComment: ["/*", "*/"], strings: QUOTES },
    markup: { blockComment: ["<!--", "-->"], markup: true },
    diff: { diff: true },
    markdown: {
      lineComments: [],
      strings: [...QUOTES, { open: "`", close: "`", multiline: true }],
    },
  }),
);

/** Alias table: fence info strings and file-extension hints to a spec key. */
const LANGUAGE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["c#", "csharp"],
  ["cs", "csharp"],
  ["dotnet", "csharp"],
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["node", "javascript"],
  ["ts", "javascript"],
  ["tsx", "javascript"],
  ["typescript", "javascript"],
  ["py", "python"],
  ["python3", "python"],
  ["sh", "shell"],
  ["bash", "shell"],
  ["zsh", "shell"],
  ["console", "shell"],
  ["shell-session", "shell"],
  ["powershell", "shell"],
  ["ps1", "shell"],
  ["golang", "go"],
  ["rs", "rust"],
  ["c++", "cpp"],
  ["yml", "yaml"],
  ["html", "markup"],
  ["xml", "markup"],
  ["svg", "markup"],
  ["vue", "markup"],
  ["scss", "css"],
  ["less", "css"],
  ["patch", "diff"],
  ["md", "markdown"],
  ["text", "plain"],
  ["txt", "plain"],
  ["plain", "plain"],
]);

const NUMBER =
  /^(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/u;
const IDENTIFIER = /^[A-Za-z_$][\w$]*/u;
const IDENTIFIER_START = /[A-Za-z_$]/u;
/** Source longer than this renders plain: highlighting is not worth the walk. */
const MAX_HIGHLIGHT_LENGTH = 50_000;

const CONSTANTS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "none",
  "nil",
  "nan",
  "infinity",
  "this",
  "self",
]);

/**
 * Highlight one fenced block.
 * @param code - The fence's source text.
 * @param lang - The fence's info string.
 * @returns One {@link HighlightLine} per source line.
 */
export function highlightLines(
  code: string,
  lang: string | undefined,
): HighlightLine[] {
  const spec = languageSpec(lang);
  if (spec === undefined || code.length > MAX_HIGHLIGHT_LENGTH) {
    return code.split("\n").map((line) => [{ text: line }]);
  }
  const spans = spec.diff === true ? highlightDiff(code) : scan(code, spec);
  const lines: HighlightSpan[][] = [[]];
  for (const span of spans) {
    span.text.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part === "") return;
      lines[lines.length - 1]?.push(
        span.cls === undefined ? { text: part } : { text: part, cls: span.cls },
      );
    });
  }
  return lines;
}

/** Resolve a fence info string to a language spec, or undefined for plain. */
function languageSpec(lang: string | undefined): LanguageSpec | undefined {
  if (lang === undefined) return undefined;
  const key = lang.trim().toLowerCase();
  if (key === "") return undefined;
  const alias = LANGUAGE_ALIASES.get(key) ?? key;
  if (alias === "plain") return undefined;
  return LANGUAGE_SPECS.get(alias);
}

/** Unified-diff lines carry their role, not a lexical class. */
function highlightDiff(code: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  code.split("\n").forEach((line, index) => {
    if (index > 0) spans.push({ text: "\n" });
    const head = line.slice(0, 3);
    const cls: HighlightClass | undefined = head.startsWith("@@")
      ? "hunk"
      : head.startsWith("+++") ||
          head.startsWith("---") ||
          head.startsWith("diff") ||
          head.startsWith("index")
        ? "meta"
        : line.startsWith("+")
          ? "insert"
          : line.startsWith("-")
            ? "delete"
            : undefined;
    spans.push(cls === undefined ? { text: line } : { text: line, cls });
  });
  return spans;
}

/**
 * The generic scanner: comments, strings, numbers, keywords, and the
 * positional conventions (value keys, decorators, preprocessor directives).
 * @param code - Source text.
 * @param spec - The language's tables.
 * @returns Colored runs, in source order.
 */
function scan(code: string, spec: LanguageSpec): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  const keywords = new Set(spec.keywords ?? []);
  const strings = [...(spec.strings ?? [])].sort(
    (left, right) => right.open.length - left.open.length,
  );
  const lineComments = spec.lineComments ?? [];
  const blockComment = spec.blockComment;
  let plain = "";
  const text = (value: string): void => {
    plain += value;
  };
  const push = (value: string, cls: HighlightClass): void => {
    if (plain !== "") {
      spans.push({ text: plain });
      plain = "";
    }
    spans.push({ text: value, cls });
  };

  let index = 0;
  while (index < code.length) {
    const marker = lineComments.find((candidate) =>
      code.startsWith(candidate, index),
    );
    if (marker !== undefined) {
      const end = code.indexOf("\n", index);
      const stop = end < 0 ? code.length : end;
      push(code.slice(index, stop), "comment");
      index = stop;
      continue;
    }
    if (blockComment !== undefined && code.startsWith(blockComment[0], index)) {
      const close = code.indexOf(
        blockComment[1],
        index + blockComment[0].length,
      );
      const stop = close < 0 ? code.length : close + blockComment[1].length;
      push(code.slice(index, stop), "comment");
      index = stop;
      continue;
    }

    const current = code[index] ?? "";
    if (
      spec.directives === true &&
      current === "#" &&
      /(^|\n)[ \t]*$/u.test(code.slice(0, index))
    ) {
      const end = code.indexOf("\n", index);
      const stop = end < 0 ? code.length : end;
      push(code.slice(index, stop), "meta");
      index = stop;
      continue;
    }
    if (
      spec.annotations === true &&
      current === "@" &&
      IDENTIFIER.test(code.slice(index + 1))
    ) {
      const name = IDENTIFIER.exec(code.slice(index + 1))?.[0] ?? "";
      push(`@${name}`, "meta");
      index += name.length + 1;
      continue;
    }

    const rule = strings.find((candidate) =>
      code.startsWith(candidate.open, index),
    );
    if (rule !== undefined) {
      const end = readStringEnd(code, index + rule.open.length, rule);
      const value = code.slice(index, end);
      push(
        value,
        spec.keys === true && isKeyAfter(code, end) ? "key" : "string",
      );
      index = end;
      continue;
    }

    if (spec.markup === true && current === "<") {
      const end = scanMarkup(code, index, push, text);
      if (end !== undefined) {
        index = end;
        continue;
      }
    }

    if (/\d/u.test(current) && !/[\w$]/u.test(code[index - 1] ?? "")) {
      const value = NUMBER.exec(code.slice(index))?.[0] ?? "";
      push(value, "number");
      index += value.length;
      continue;
    }

    if (IDENTIFIER_START.test(current)) {
      const word = IDENTIFIER.exec(code.slice(index))?.[0] ?? "";
      const folded = spec.caseInsensitive === true ? word.toLowerCase() : word;
      const cls: HighlightClass | undefined = keywords.has(folded)
        ? "keyword"
        : CONSTANTS.has(folded)
          ? "constant"
          : spec.keys === true && isKeyAfter(code, index + word.length)
            ? "key"
            : undefined;
      if (cls === undefined) text(word);
      else push(word, cls);
      index += word.length;
      continue;
    }

    text(current);
    index += 1;
  }
  if (plain !== "") spans.push({ text: plain });
  return spans;
}

/** True when the token ending at `end` names a `key:`/`key=` entry. */
function isKeyAfter(code: string, end: number): boolean {
  let index = end;
  while (code[index] === " " || code[index] === "\t") index += 1;
  return code[index] === ":" || code[index] === "=";
}

/**
 * The index just past a string that starts at `index`, or `code.length` when
 * it never closes. A single-line rule stops at the newline it cannot cross.
 */
function readStringEnd(code: string, index: number, rule: StringRule): number {
  let cursor = index;
  while (cursor < code.length) {
    const current = code[cursor] ?? "";
    if (rule.escape === true && current === "\\") {
      cursor += 2;
      continue;
    }
    if (code.startsWith(rule.close, cursor)) {
      if (
        rule.doubled === true &&
        code.startsWith(rule.close, cursor + rule.close.length)
      ) {
        cursor += rule.close.length * 2;
        continue;
      }
      return cursor + rule.close.length;
    }
    if (current === "\n" && rule.multiline !== true) return cursor;
    cursor += 1;
  }
  return code.length;
}

/**
 * A markup token at `index`: comment, doctype, or a tag with its attributes.
 * @returns The index just past the token, or undefined when `<` starts none.
 */
function scanMarkup(
  code: string,
  index: number,
  push: (value: string, cls: HighlightClass) => void,
  text: (value: string) => void,
): number | undefined {
  if (code.startsWith("<!--", index)) {
    const close = code.indexOf("-->", index);
    const stop = close < 0 ? code.length : close + 3;
    push(code.slice(index, stop), "comment");
    return stop;
  }
  if (code.startsWith("<!", index)) {
    const close = code.indexOf(">", index);
    const stop = close < 0 ? code.length : close + 1;
    push(code.slice(index, stop), "meta");
    return stop;
  }
  const name = /^<\/?([A-Za-z][\w:.-]*)/u.exec(code.slice(index));
  if (name === null) return undefined;
  push(name[0], "tag");
  let cursor = index + name[0].length;
  while (cursor < code.length && code[cursor] !== ">" && code[cursor] !== "<") {
    const current = code[cursor] ?? "";
    if (current === "/" && code[cursor + 1] === ">") break;
    if (/\s/u.test(current)) {
      text(current);
      cursor += 1;
      continue;
    }
    const attribute = /^[^\s=/>]+/u.exec(code.slice(cursor))?.[0] ?? current;
    push(attribute, "attr");
    cursor += attribute.length;
    const equals = /^\s*=\s*/u.exec(code.slice(cursor))?.[0] ?? "";
    if (equals === "") continue;
    text(equals);
    cursor += equals.length;
    const quote = code[cursor];
    if (quote === '"' || quote === "'") {
      const close = code.indexOf(quote, cursor + 1);
      const stop = close < 0 ? code.length : close + 1;
      push(code.slice(cursor, stop), "string");
      cursor = stop;
    }
  }
  return cursor;
}
