/**
 * Composer input classification for the slash interface.
 *
 * The grammars are mirrors, not inventions: a command line is what the native
 * command runtime parses (`/name` at byte zero, name then end-of-input or
 * whitespace, everything after kept verbatim as `rawInput`), and a skill
 * gesture is what `dsh-tool-skill` recognises (any whitespace-bounded `/name`
 * token with the public skill-name grammar). A line that matches neither is
 * ordinary prose and must keep behaving exactly as it did before this feature.
 *
 * Deliberately dependency-free: this module is inlined into the browser
 * bundle, where the Host's config surface must not follow it.
 */

/** `/name` at byte zero — the shape the native command runtime parses. */
const COMMAND_LINE = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u;

/** Mirror of the native `SKILL_GESTURE`: whitespace-bounded kebab-case. */
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/gu;

/**
 * A name still being typed in the composer: no whitespace yet, so the token
 * is the palette's filter rather than an invocation. Bare `/` is the empty
 * query that opens the palette on its own.
 */
const PALETTE_QUERY = /^[a-z0-9][a-z0-9_-]*$/u;

export interface QaSlashLine {
  readonly name: string;
  /** Exact text after the name, including the separator whitespace. */
  readonly args: string;
}

/**
 * Parse a command-shaped line. `undefined` means the line is not one — either
 * it is not slash-led at all, or the token after the slash is not a command
 * name (`/usr/bin/env` stays a path, not a call).
 */
export function parseSlashLine(input: string): QaSlashLine | undefined {
  const match = COMMAND_LINE.exec(input);
  if (match === null) return undefined;
  return Object.freeze({
    name: match[1] ?? "",
    args: input.slice(match[0].length),
  });
}

/** The palette filter of a draft, or `undefined` when the palette is closed. */
export function slashPaletteQuery(input: string): string | undefined {
  if (!input.startsWith("/")) return undefined;
  const rest = input.slice(1);
  if (rest === "") return "";
  return PALETTE_QUERY.test(rest) ? rest : undefined;
}

/**
 * Every whitespace-bounded `/name` gesture in the text, first-seen order and
 * deduplicated. The Host owns invocation; this list exists only so the QA
 * surface can warn about a gesture its own policy withholds before the turn
 * is submitted.
 */
export function skillGestures(input: string): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of input.matchAll(SKILL_GESTURE)) {
    const name = match[2];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return Object.freeze(names);
}

/** The invocation a submitted draft carries, once its route is decided. */
export interface QaSlashInvocation {
  readonly name: string;
  /** Text after the name with its separator whitespace removed. */
  readonly args: string;
}

/**
 * The invocation a draft names, independent of the catalog. Used for the
 * routing decision and for the "unknown command" refusal, both of which must
 * work while the catalog itself is unavailable.
 */
export function slashInvocation(input: string): QaSlashInvocation | undefined {
  const line = parseSlashLine(input);
  if (line === undefined) return undefined;
  return Object.freeze({
    name: line.name,
    args: line.args.replace(/^[\t\n\r ]+/u, ""),
  });
}
