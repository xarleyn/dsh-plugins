/**
 * Button accessible names.
 *
 * A button whose only child is an icon has no accessible name: a screen reader
 * announces it as an unlabelled "button", and `getByRole("button", { name })`
 * cannot reach it, so a test that wants to press it has to fall back to a
 * class name or a coordinate — both of which keep passing after the button
 * becomes unreachable to a human too. Every client bundle in this workspace
 * renders buttons from source under `src/`, so the name can be asserted there,
 * once, instead of by every plugin's own test suite.
 *
 * A button counts as named when it carries `aria-label`, `aria-labelledby` or
 * `title`, or when its children can produce text: a literal string, or an
 * expression that is not recognisably an icon. `title` is accepted because ARIA
 * lets it name a control, but `aria-label` is the convention this repository
 * prefers (see the label style in the qa-browser and qa-surface panels).
 *
 * The check is deliberately conservative: it reports a button only when it can
 * see there is no name at all, or when the children are expressions that name
 * nothing but icons (`{IconCheck()}`, `{icon}`). Anything it cannot read — a
 * spread attribute, an attributes object it cannot parse, an expression whose
 * value is decided elsewhere — is left alone rather than guessed at, because a
 * gate that cries wolf on every dynamic label would be switched off instead of
 * fixed.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoots = ["plugins", "packages"];
const sourceExtensions = /\.[cm]?[jt]sx?$/u;
const skippedDirectories = new Set([
  "node_modules",
  "lib",
  "dist",
  "coverage",
  "tests",
]);

const accessibleNameKey = "(?:aria-label|aria-labelledby|title)";
/** A JSX comment renders nothing, so `{/* … *\/}` is never a name. */
const jsxComment = /\{\s*\/\*[\s\S]*?\*\/\s*\}/gu;
const textCharacter = /[0-9A-Za-z\u00c0-\u024f\u0400-\u04ff]/u;
/** Identifier or call that names an icon and nothing else. */
const iconWord =
  /[A-Za-z0-9_]*(?:icon|glyph|svg|chevron|caret|arrow|ellipsis|kebab|grip|spinner|loader)/iu;
const stringLiteral = /["'`]/u;

const buttonPatterns = [
  { kind: "jsx", pattern: /<button\b/gu },
  {
    kind: "call",
    // The comma is part of the match so the attributes argument can be required
    // to be an object literal: `createElement("button", props, …)` spreads an
    // object this check cannot read, and guessing at its keys would invent
    // failures.
    pattern: /createElement\(\s*["']button["']\s*,\s*/gu,
  },
];

/**
 * Scan forward from an opening `{`, `(` or `[` for the character that closes
 * it, ignoring anything inside a string, a template literal or a nested
 * region. Returns an index one past the closer, or -1 when it never closes.
 */
function regionEnd(text, open) {
  const openers = "{([";
  const closers = "})]";
  let depth = 0;
  let quote = null;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (character === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (openers.includes(character)) depth += 1;
    else if (closers.includes(character)) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/** The `>` that ends the tag opened just before `start`, quote-aware. */
function tagEnd(text, start) {
  let quote = null;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (character === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{" || character === "(" || character === "[") depth += 1;
    else if (character === "}" || character === ")" || character === "]") {
      depth -= 1;
    } else if (character === ">" && depth === 0) return index + 1;
  }
  return -1;
}

/** An expression whose value can only be an icon, never a label. */
function isIconExpression(expression) {
  if (stringLiteral.test(expression)) return false;
  return iconWord.test(expression);
}

/**
 * Name verdict for a JSX children region: `null` when the children can produce
 * text, otherwise the reason the button is unnamed.
 */
function jsxChildrenVerdict(region) {
  let literal = "";
  const expressions = [];
  let index = 0;
  while (index < region.length) {
    const character = region[index];
    if (character === "<") {
      const end = tagEnd(region, index + 1);
      index = end === -1 ? region.length : end;
      continue;
    }
    if (character === "{") {
      const end = regionEnd(region, index);
      if (end === -1) return null;
      expressions.push(region.slice(index + 1, end - 1));
      index = end;
      continue;
    }
    literal += character;
    index += 1;
  }
  if (textCharacter.test(literal)) return null;
  if (expressions.length === 0) return "no content";
  const iconsOnly = expressions.every((expression) =>
    isIconExpression(expression),
  );
  return iconsOnly ? "children are icons only" : null;
}

/** Every argument of a call, split on the commas that sit at its top level. */
function topLevelArguments(region) {
  const segments = [];
  let start = 0;
  let index = 0;
  while (index < region.length) {
    const character = region[index];
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      index += 1;
      while (index < region.length) {
        if (region[index] === quote && region[index - 1] !== "\\") break;
        index += 1;
      }
    } else if (character === "{" || character === "(" || character === "[") {
      const end = regionEnd(region, index);
      index = end === -1 ? region.length : end;
      continue;
    } else if (character === ",") {
      segments.push(region.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  segments.push(region.slice(start));
  const trimmed = segments.map((segment) => segment.trim()).filter(Boolean);
  return trimmed;
}

/** An explicit name value that cannot produce a non-empty accessible name. */
function emptyNameValue(value) {
  const trimmed = value.trim();
  if (/^(?:undefined|null|false)$/u.test(trimmed)) return true;
  if (/^(?:""|''|``)$/u.test(trimmed)) return true;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return emptyNameValue(trimmed.slice(1, -1));
  }
  return false;
}

/** Whether the opening site itself carries a usable naming attribute. */
function hasNameAttribute(attributes, kind) {
  if (kind === "jsx") {
    const pattern = new RegExp(
      `(?:^|\\s)${accessibleNameKey}\\s*=\\s*(\\{[^}]*\\}|"[^"]*"|'[^']*')`,
      "gu",
    );
    return [...attributes.matchAll(pattern)].some(
      (match) => !emptyNameValue(match[1] ?? ""),
    );
  }

  if (!attributes.startsWith("{") || !attributes.endsWith("}")) return false;
  const properties = topLevelArguments(attributes.slice(1, -1));
  const pattern = new RegExp(
    `^["']?${accessibleNameKey}["']?\\s*:\\s*([\\s\\S]+)$`,
    "u",
  );
  return properties.some((property) => {
    const match = pattern.exec(property);
    return match !== null && !emptyNameValue(match[1] ?? "");
  });
}

/** Name verdict for the children arguments of `createElement("button", …)`. */
function callChildrenVerdict(region) {
  const arguments_ = topLevelArguments(region);
  if (arguments_.length === 0) return "no content";
  const carriesText = arguments_.some((argument) =>
    /["'`][^"'`]*[0-9A-Za-z\u0400-\u04ff]/u.test(argument),
  );
  if (carriesText) return null;
  const iconsOnly = arguments_.every((argument) => isIconExpression(argument));
  return iconsOnly ? "children are icons only" : null;
}

/**
 * Every unnamed button in one source file, as
 * `{ index, kind }` entries the caller can turn into line numbers.
 */
export function auditButtonNames(source) {
  // Masking with spaces keeps every offset, and therefore every line number,
  // exactly where it was.
  const text = source.replace(jsxComment, (comment) =>
    comment.replace(/[^\n]/gu, " "),
  );
  const findings = [];
  for (const { kind, pattern } of buttonPatterns) {
    for (const match of text.matchAll(pattern)) {
      let attributes;
      let children;
      if (kind === "jsx") {
        const attributesStart = match.index + "<button".length;
        const attributesEnd = tagEnd(text, attributesStart);
        if (attributesEnd === -1) continue;
        attributes = text.slice(attributesStart, attributesEnd - 1);
        if (attributes.trimEnd().endsWith("/")) {
          children = "";
        } else {
          const childrenEnd = text.indexOf("</button>", attributesEnd);
          children =
            childrenEnd === -1
              ? text.slice(attributesEnd, attributesEnd + 400)
              : text.slice(attributesEnd, childrenEnd);
        }
      } else {
        const attributesStart = match.index + match[0].length;
        if (text[attributesStart] !== "{") continue;
        const attributesEnd = regionEnd(text, attributesStart);
        if (attributesEnd === -1) continue;
        attributes = text.slice(attributesStart, attributesEnd);
        const callEnd = regionEnd(text, match.index + "createElement".length);
        if (callEnd === -1) continue;
        children = text.slice(attributesEnd, callEnd - 1);
      }
      // A spread attribute can carry the label, so the site is out of reach.
      if (attributes.includes("...")) continue;
      if (hasNameAttribute(attributes, kind)) continue;
      const reason =
        kind === "jsx"
          ? jsxChildrenVerdict(children)
          : callChildrenVerdict(children);
      if (reason === null) continue;
      findings.push({ index: match.index, kind, reason });
    }
  }
  return findings;
}

/** How many button sites a source file contains, for the success line. */
export function countButtonSites(source) {
  return buttonPatterns.reduce(
    (total, { pattern }) => total + [...source.matchAll(pattern)].length,
    0,
  );
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    },
  );
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) continue;
      files.push(...(await sourceFiles(path)));
    } else if (sourceExtensions.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Assert every button the workspace renders in a browser carries an accessible
 * name. Throws with the offending `path:line` list, in the shape the other
 * repository gates report failures.
 */
export async function verifyButtonNames(repoRoot = workspaceRoot) {
  const findings = [];
  let sources = 0;
  let buttons = 0;
  for (const root of sourceRoots) {
    const directory = join(repoRoot, root);
    const packages = await readdir(directory, { withFileTypes: true }).catch(
      (error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of packages) {
      if (!entry.isDirectory()) continue;
      const files = await sourceFiles(join(directory, entry.name, "src"));
      for (const file of files) {
        const source = await readFile(file, "utf8");
        sources += 1;
        buttons += countButtonSites(source);
        const sourcePath = relative(repoRoot, file).split(sep).join("/");
        for (const finding of auditButtonNames(source)) {
          const line = source.slice(0, finding.index).split("\n").length;
          findings.push(`${sourcePath}:${line}: button has ${finding.reason}`);
        }
      }
    }
  }
  if (findings.length > 0) {
    throw new Error(
      `button accessible names failed:\n- ${findings.join("\n- ")}`,
    );
  }
  return { sources, buttons };
}

async function main() {
  const { sources, buttons } = await verifyButtonNames();
  console.log(
    `button accessible names verified for ${buttons} buttons in ${sources} sources`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
