/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
/**
 * Ordered, operator-configured regex filters for memory plugin input.
 *
 * Rules are sed-style strings, applied in order to a single piece of text:
 *   s/^\s*ultrathink\s+//i   substitute (add `g` to replace every match)
 *   d|^\s*[/!]|              drop the text when the pattern matches
 *   k/^\?ov\b/               keep the text only when the pattern matches
 *   user:d/^\s*\/clear\b/    apply to one role only
 *
 * A malformed rule becomes an entry in `errors` and is skipped rather than
 * throwing, so a typo in a config file cannot take a hook down.
 */

const OPS: ReadonlySet<string> = new Set(["s", "d", "k"]);
const SCOPES = ["user", "assistant"] as const;
const ALLOWED_FLAGS = "imsug";

/** The operation a rule carries. */
type InputFilterOp = "s" | "d" | "k";

/** The role a rule may be limited to; `""` means every role. */
type InputFilterScope = "" | "user" | "assistant";

/** One compiled rule, ready to run over a piece of text. */
export interface InputFilterRule {
  readonly op: "s" | "d" | "k";
  readonly scope: "" | "user" | "assistant";
  readonly re: RegExp;
  readonly replacement: string | null;
  readonly source: string;
  readonly index: number;
}

/** The shape `parseInputFilterRule` returns for a rule it could not compile. */
export interface InputFilterParseError {
  readonly source: string;
  readonly error: string;
}

/** A parse result: either a usable rule, or a message describing what is wrong. */
export interface ParsedInputFilterRule {
  readonly op: "s" | "d" | "k";
  readonly scope: "" | "user" | "assistant";
  readonly re: RegExp;
  readonly replacement: string | null;
  readonly source: string;
  readonly error?: string;
}

/** The outcome of compiling a configured filter list. */
export interface InputFilterCompileResult {
  readonly rules: readonly InputFilterRule[];
  readonly errors: readonly { readonly index: number; readonly source: string; readonly message: string }[];
}

/** What one pass of the filters did to a piece of text. */
export interface InputFilterVerdict {
  readonly text: string;
  readonly changed: boolean;
  readonly dropped: boolean;
  readonly ruleIndex: number;
  readonly op: "" | "s" | "d" | "k";
}

/**
 * Read one delimited field. `\` always consumes the next character, and only
 * `\<delim>` is un-escaped, so `\d` / `\b` / `\x2c` reach RegExp verbatim.
 * Returns the index of the closing delimiter, or -1 when it is missing.
 */
function scanField(source: string, start: number, delim: string): { value: string; end: number } {
  let out = "";
  let i = start;
  while (i < source.length) {
    const c = source[i] ?? "";
    if (c === "\\") {
      const next = source[i + 1];
      if (next === undefined) {
        out += "\\";
        i += 1;
        continue;
      }
      out += next === delim ? next : "\\" + next;
      i += 2;
      continue;
    }
    if (c === delim) return { value: out, end: i };
    out += c;
    i += 1;
  }
  return { value: out, end: -1 };
}

export function parseInputFilterRule(source: unknown): ParsedInputFilterRule {
  if (typeof source !== "string") {
    return { source: String(source ?? ""), error: "rule must be a string" } as ParsedInputFilterRule;
  }
  const raw = source.trim();
  if (!raw) return { source: raw, error: "rule is empty" } as ParsedInputFilterRule;

  let scope: InputFilterScope = "";
  let rest = raw;
  for (const candidate of SCOPES) {
    if (rest.startsWith(`${candidate}:`)) {
      scope = candidate;
      rest = rest.slice(candidate.length + 1);
      break;
    }
  }

  const op = rest[0] || "";
  if (!OPS.has(op)) {
    return {
      source: raw,
      error: `unknown operation "${op}" — expected s (substitute), d (drop) or k (keep)`,
    } as ParsedInputFilterRule;
  }
  const delim = rest[1];
  if (delim === undefined) {
    return { source: raw, error: `missing delimiter after "${op}"` } as ParsedInputFilterRule;
  }
  if (/[A-Za-z0-9\s\\]/.test(delim)) {
    return {
      source: raw,
      error: `invalid delimiter ${JSON.stringify(delim)} — use punctuation such as / | # or :`,
    } as ParsedInputFilterRule;
  }

  const first = scanField(rest, 2, delim);
  const pattern = first.value;
  let replacement: string | null = null;
  // Both branches below assign or return, so no initializer is needed.
  let flagsRaw: string;
  if (op === "s") {
    if (first.end < 0) {
      return { source: raw, error: `missing ${JSON.stringify(delim)} after the pattern` } as ParsedInputFilterRule;
    }
    const second = scanField(rest, first.end + 1, delim);
    if (second.end < 0) {
      return {
        source: raw,
        error: `missing ${JSON.stringify(delim)} after the replacement — write s${delim}pattern${delim}replacement${delim}`,
      } as ParsedInputFilterRule;
    }
    replacement = second.value;
    flagsRaw = rest.slice(second.end + 1);
  } else {
    flagsRaw = first.end < 0 ? "" : rest.slice(first.end + 1);
  }

  if (!pattern) return { source: raw, error: "pattern is empty" } as ParsedInputFilterRule;

  const flags = new Set<string>();
  for (const flag of flagsRaw) {
    if (!ALLOWED_FLAGS.includes(flag)) {
      return { source: raw, error: `unknown flag "${flag}" — allowed flags are i, m, s, u, g` } as ParsedInputFilterRule;
    }
    if (flags.has(flag)) return { source: raw, error: `duplicate flag "${flag}"` } as ParsedInputFilterRule;
    flags.add(flag);
  }
  // d/k decide with .test(), which advances lastIndex on a global regex and
  // would then alternate between calls. `g` means nothing there, so drop it.
  if (op !== "s") flags.delete("g");

  let re: RegExp;
  try {
    re = new RegExp(pattern, [...flags].join(""));
  } catch (err) {
    // V8 already says "Invalid regular expression: <pattern>: <why>"; keep that
    // detail without stuttering the prefix the doctors key off.
    const message = (err as { message?: string } | null)?.message || String(err);
    return {
      source: raw,
      error: /^invalid regular expression/i.test(message)
        ? `invalid${message.slice("Invalid".length)}`
        : `invalid regular expression: ${message}`,
    } as ParsedInputFilterRule;
  }

  return { op: op as InputFilterOp, scope, re, replacement, source: raw };
}

export function compileInputFilters(rules: unknown): InputFilterCompileResult {
  const compiled: InputFilterRule[] = [];
  const errors: { readonly index: number; readonly source: string; readonly message: string }[] = [];
  const list: readonly unknown[] = Array.isArray(rules) ? rules : [];
  list.forEach((entry, index) => {
    if (typeof entry !== "string") {
      errors.push({ index, source: String(entry ?? ""), message: "rule must be a string" });
      return;
    }
    if (!entry.trim()) return;
    const parsed = parseInputFilterRule(entry);
    if (parsed.error) errors.push({ index, source: parsed.source, message: parsed.error });
    else compiled.push({ ...parsed, index });
  });
  return { rules: compiled, errors };
}

/**
 * Run compiled rules over `text`.
 *
 * `substituteOnly` skips the d/k operations, so a caller that already took one
 * drop decision for a turn can rewrite its individual pieces without taking a
 * second, possibly contradictory one.
 */
export function applyInputFilters(
  text: unknown,
  compiled: readonly InputFilterRule[],
  { role = "", substituteOnly = false }: { readonly role?: string; readonly substituteOnly?: boolean } = {},
): InputFilterVerdict {
  const original = typeof text === "string" ? text : String(text ?? "");
  let current = original;
  const rules: readonly InputFilterRule[] = Array.isArray(compiled) ? compiled : [];
  for (const rule of rules) {
    if (rule.scope && rule.scope !== role) continue;
    if (rule.op === "s") {
      current = current.replace(rule.re, rule.replacement as string);
      continue;
    }
    if (substituteOnly) continue;
    const matched = rule.re.test(current);
    if ((rule.op === "d" && matched) || (rule.op === "k" && !matched)) {
      return { text: "", changed: false, dropped: true, ruleIndex: rule.index, op: rule.op };
    }
  }
  const finalText = current.trim();
  return {
    text: finalText,
    changed: finalText !== original,
    dropped: false,
    ruleIndex: -1,
    op: "",
  };
}
