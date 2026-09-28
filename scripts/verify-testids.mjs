/**
 * Test id conventions.
 *
 * A `data-testid` is the address a test uses to reach a node without naming the
 * text a person reads or the class a stylesheet owns: an assertion on a visible
 * label survives the label moving into a tooltip, and one on a class survives a
 * restyle, while `getByTestId` says which slot it actually pressed. Epic #453
 * made that address a convention — one attribute name, a kebab-case ASCII value
 * carrying the package's zone, one value owning one file — and this gate is the
 * half of the convention a machine can read, so it does not rot between the
 * review that approved an id and the bundle that ships it.
 *
 * Four rules, each reported as `path:line`:
 *
 * 1. the attribute is spelled exactly `data-testid`. `data-test-id` and
 *    `data-testId` are the same intent written where `getByTestId` cannot see it
 *    — the query resolves one spelling, so a near miss is an assertion against a
 *    selector that matches nothing, which is the failure mode `toBeNull()`
 *    reports as green.
 * 2. a value decided at the site is ASCII kebab-case, and is longer than one
 *    segment: the zone prefix is what keeps two plugins apart once they render
 *    into the same page.
 * 3. the same value is not written twice in the workspace. Within one file a
 *    value may repeat — that is how the epic names one slot in its mutually
 *    exclusive states, `qa-message-image` at loading, broken and loaded — and no
 *    static read can tell two branches from two mounted nodes. Across a file
 *    boundary nothing excuses the collision, and across a package boundary the
 *    collision is the very thing rule 2's zone prefix exists to prevent, so the
 *    comparison is not stopped at the package edge.
 * 4. no value carries Cyrillic, a task number or a person. AGENTS.md puts that
 *    rule over fixtures and published strings, and an id is both: it ships in the
 *    tarball, and it names the node in every screenshot of a run. A task number
 *    is any all-digit segment; a person is checked against the names the
 *    workspace's own manifests declare, so the rule carries no list to keep
 *    current and stays silent on an id that names no one here.
 *
 * A site is where a value reaches the attribute, which is one step wider than
 * the attribute itself: a card that renders its fields through its own controls
 * names the slot with a `testId` prop, and the id is written there, not at the
 * `data-testid={testId}` one component down. Those 500-odd props carry the same
 * values and follow the same convention, so rules 2 to 4 and the collision read
 * them too; rule 1 does not, because `testId` is the prop's name, not a
 * misspelling of the attribute's.
 *
 * What the gate leaves alone is a value it cannot read. `${testIdZone}-empty`
 * and `props.testId` are composed at runtime, so their prefix is not a zone this
 * file knows and their value is not a collision it can prove; the fixed text
 * inside a template is still read for script and digits, because that part no
 * caller can change. A quoted string that is an argument or a comparison operand
 * — the `"label"` of `testIdPart(testId, "label")`, the `"error"` of
 * `entry.severity === "error"` — names no node at all, so it is skipped: asking
 * it to carry a zone would report the code that reads best. A comment is read the
 * same way it renders — as nothing — because a note about the spelling a file
 * used to carry, or a doc example, names no node either.
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

const attributeName = "data-testid";
/** The prop a card names its own control's slot with. */
const propName = "testId";
/** Every spelling of the attribute name that is an attempt at `data-testid`. */
const attributeNameSite = /\bdata[-_]?test[-_]?id(?![\w-])/giu;
/**
 * The `testId` prop a card hands to its own controls. The preceding character is
 * excluded rather than matched as a word boundary, so `data-testId` stays the
 * misspelling rule's and `props.testId` stays a pass-through, never a name.
 */
const propSite = /(^|[^$\w.-])testId(?![\w-])(\s*[:=])(?!=)/gu;
/** The same attribute written as a key of a `createElement` attributes object. */
const attributesKeySite =
  /(["'])(data[-_]?test[-_]?id)\1\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/giu;

const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const cyrillic = /[\u0400-\u04ff]/u;
const nonAscii = /[^\u0020-\u007e]/u;
const allDigits = /^\d+$/u;
const taskNumberSegment = /(?:^|-)\d+(?:-|$)/u;
const separator = /[^a-z0-9]+/u;
/** The operator that puts a string in value position: a branch, not a test. */
const valuePosition = /(?:\?|:|\|\||&&|=>|\?\?)\s*$/u;
/**
 * What may stand in front of a comment opening: whitespace, the line's start, or a
 * boundary. A slash that follows a colon, a letter or a backslash belongs to
 * something else — the `//` of `viking://`, the escaped pair that closes the
 * regular expression `/^\.\//u`.
 */
const commentStarter = /[\s{}()[\],;]/u;
/** What may not stand in front of a quote: an identifier char means an apostrophe. */
const joinedToWord = /[$\w\\]/u;

/**
 * The offsets every comment owns in one source, as `[start, end)` pairs.
 *
 * A comment renders nothing, so it is not a place where an attribute is written:
 * the note above a field that says `rename data-test-id to data-testid`, and the
 * doc example that shows `<div data-testid="composer" />`, both describe the
 * convention instead of breaking it.
 *
 * Strings and templates are stepped over rather than scanned through, because
 * the shortcut would blind the read: the `//` in `"viking://~/memories"` and the
 * `/*` in a `"services/**"` glob are a URI and a pattern, not a comment, and a
 * fake block comment would hide the rest of the file. An apostrophe is kept out
 * of the string state for the mirror reason — `don't` in card copy is no one's
 * quote, and treating it as one would hide the attributes that share its line.
 */
function commentRanges(source) {
  const ranges = [];
  const templates = [];
  let quote = "";
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== "") {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      else if (
        quote === "`" &&
        character === "$" &&
        source[index + 1] === "{"
      ) {
        templates.push(depth);
        depth = 0;
        quote = "";
        index += 1;
      } else if (quote !== "`" && character === "\n") {
        quote = "";
      }
      continue;
    }
    if (
      (character === '"' || character === "'" || character === "`") &&
      !joinedToWord.test(source[index - 1] ?? "")
    ) {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      if (depth === 0 && templates.length > 0) {
        quote = "`";
        depth = templates.pop() ?? 0;
      } else depth = Math.max(0, depth - 1);
    }
    if (character !== "/") continue;
    const boundary = index === 0 || commentStarter.test(source[index - 1]);
    if (source[index + 1] === "/" && boundary) {
      const newline = source.indexOf("\n", index);
      const stop = newline === -1 ? source.length : newline;
      ranges.push([index, stop]);
      index = stop - 1;
      continue;
    }
    if (source[index + 1] === "*" && boundary) {
      const closer = source.indexOf("*/", index + 2);
      const stop = closer === -1 ? source.length : closer + 2;
      ranges.push([index, stop]);
      index = stop - 1;
    }
  }
  return ranges;
}

/**
 * The source with every comment blanked. Nothing is removed: a blanked character
 * keeps its own index and its own line break, so the offsets the caller reports
 * are the ones the author sees.
 */
function withoutComments(source) {
  const ranges = commentRanges(source);
  if (ranges.length === 0) return source;
  let text = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    text += source.slice(cursor, start);
    text += source.slice(start, end).replace(/[^\n]/g, " ");
    cursor = end;
  }
  return text + source.slice(cursor);
}

/**
 * Whether a name sits where an attribute is written. A selector string —
 * `` `[data-testid="${id}"]` ``, which the translator builds to protect a node
 * from re-rendering — reads as `data-testid="…"` too, but it names nothing to
 * render and its `${…}` is not a value, so only a name after a separator is an
 * attribute site. The spelling rule below still reads the string: a selector
 * written `data-test-id` matches no node either.
 */
function isAttributePosition(text, index) {
  return index === 0 || /\s/u.test(text[index - 1]);
}

/**
 * Scan forward from an opening `{` for the character that closes it, ignoring
 * anything inside a string. Returns an index one past the closer, or -1 when it
 * never closes.
 */
function regionEnd(text, open) {
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
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/** A template's fixed text, with every `${…}` folded into one separator. */
function templateSkeleton(template) {
  return template
    .replace(/\$\{[^{}]*\}/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-|-$/gu, "");
}

/**
 * The value written at a site, or null where this read cannot reach it. `start`
 * is the offset just past the name, and `assignment` is what puts the value after
 * it: `=` for a JSX attribute or prop, `:` for a property of the attributes
 * object `createElement` takes. A second `=` is a comparison, not a write.
 */
function valueAfter(text, start, assignment) {
  let index = start;
  while (index < text.length && /\s/u.test(text[index])) index += 1;
  if (text[index] !== assignment) return null;
  index += 1;
  if (assignment === "=" && text[index] === "=") return null;
  while (index < text.length && /\s/u.test(text[index])) index += 1;
  const quote = text[index];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, index + 1);
    if (end === -1) return null;
    return { kind: "quoted", text: text.slice(index + 1, end) };
  }
  if (quote !== "{") return null;
  const end = regionEnd(text, index);
  if (end === -1) return null;
  return { kind: "braced", text: text.slice(index + 1, end - 1) };
}

/**
 * What a site renders. `owned` is the value the attribute always carries, which
 * is the only kind the workspace can hold once; `conditional` is a literal that
 * reaches the attribute only along one branch, so the site may render several of
 * them and none of them proves a collision; `composed` is the fixed text of a
 * value built at runtime. A quoted string in a test or an argument — the `"error"`
 * of `entry.severity === "error"`, the `"label"` of `testIdPart(testId, "label")`
 * — names neither, because it is a piece of a name or a comparison, never an id.
 */
function readableValues(value) {
  if (value === null) return { owned: [], conditional: [], composed: [] };
  if (value.kind === "quoted") {
    return { owned: [value.text], conditional: [], composed: [] };
  }
  const expression = value.text;
  const trimmed = expression.trim();
  const whole = /^"([^"]*)"$|^'([^']*)'$/.exec(trimmed);
  if (whole !== null) {
    return {
      owned: [whole[1] ?? whole[2] ?? ""],
      conditional: [],
      composed: [],
    };
  }
  const conditional = [];
  for (const match of expression.matchAll(/"([^"]*)"|'([^']*)'/gu)) {
    const before = expression.slice(0, match.index);
    if (before.trim().length > 0 && !valuePosition.test(before)) continue;
    conditional.push(match[1] ?? match[2] ?? "");
  }
  const composed = [...expression.matchAll(/`([^`]*)`/gu)].map((match) => ({
    written: match[1],
    skeleton: templateSkeleton(match[1]),
  }));
  return { owned: [], conditional, composed };
}

/**
 * Every test id site in one source, as `{ index, name, attribute, prop, owned,
 * conditional, composed }`. The name is kept as written, so a misspelling is
 * reportable even inside a selector string, and offsets survive because comment
 * masking blanks characters rather than removing them.
 */
function testIdSites(source) {
  const text = withoutComments(source);
  const sites = [];
  for (const match of text.matchAll(attributeNameSite)) {
    // A name inside quotes is a key or a string, read by `attributesKeySite`
    // below or by neither: nothing here can tell a misspelled key from a label.
    if (/["']$/u.test(text.slice(0, match.index))) continue;
    const attribute = isAttributePosition(text, match.index);
    const values = readableValues(
      attribute ? valueAfter(text, match.index + match[0].length, "=") : null,
    );
    sites.push({
      index: match.index,
      name: match[0],
      attribute,
      prop: false,
      ...values,
    });
  }
  for (const match of text.matchAll(propSite)) {
    const name = match.index + match[1].length;
    const values = readableValues(
      valueAfter(text, name + propName.length, match[2].slice(-1)),
    );
    sites.push({
      index: name,
      name: propName,
      attribute: carriesValue(values),
      prop: true,
      ...values,
    });
  }
  for (const match of text.matchAll(attributesKeySite)) {
    const candidate = match[3] ?? match[4] ?? match[5] ?? "";
    const template = match[5] !== undefined;
    sites.push({
      index: match.index,
      name: match[2],
      attribute: true,
      prop: false,
      owned: template ? [] : [candidate],
      conditional: [],
      composed: template
        ? [{ written: candidate, skeleton: templateSkeleton(candidate) }]
        : [],
    });
  }
  return sites;
}

/** Whether a site writes a value this read can reach at all. */
function carriesValue(values) {
  return (
    values.owned.length + values.conditional.length + values.composed.length > 0
  );
}

/**
 * Whether a site writes the attribute under a name `getByTestId` cannot resolve.
 * The `testId` prop is the component's own name for the slot, not a misspelling
 * of the attribute's, so it is never a finding here.
 */
function misspelled(site) {
  return !site.prop && site.name !== attributeName;
}

/** Why a value is not what the convention says, or null when it is. */
function valueVerdict(value, personNames) {
  if (value.length === 0) return "carries an empty value";
  if (cyrillic.test(value)) return `spells "${value}" in Cyrillic`;
  if (nonAscii.test(value)) return `spells "${value}" outside ASCII`;
  if (taskNumberSegment.test(value)) return `names a task number in "${value}"`;
  const named = value
    .toLowerCase()
    .split(separator)
    .find((segment) => personNames.has(segment));
  if (named !== undefined) return `names a person in "${value}"`;
  if (!kebabCase.test(value)) return `"${value}" is not kebab-case ASCII`;
  if (!value.includes("-")) return `"${value}" carries no zone prefix`;
  return null;
}

/**
 * Why the fixed text of a composed value is not what the convention says. The
 * rules are read off `skeleton`, with every `${…}` folded into a separator, and
 * reported in `written`, because that is the text the author looks at. The prefix
 * and the collisions are this file's blind spot by construction, so only what no
 * caller can change is asked about.
 */
function composedVerdict({ skeleton, written }, personNames) {
  if (skeleton.length === 0) return null;
  if (cyrillic.test(skeleton)) return `spells "${written}" in Cyrillic`;
  if (nonAscii.test(skeleton)) return `spells "${written}" outside ASCII`;
  const segments = skeleton.split("-").filter(Boolean);
  if (segments.some((segment) => allDigits.test(segment))) {
    return `names a task number in "${written}"`;
  }
  if (segments.some((segment) => personNames.has(segment.toLowerCase()))) {
    return `names a person in "${written}"`;
  }
  if (/[^a-z0-9-]/u.test(skeleton)) {
    return `"${written}" is not kebab-case ASCII`;
  }
  return null;
}

/**
 * Every test id site in one source file that breaks the convention, as
 * `{ index, value, message }` entries the caller turns into line numbers. `value`
 * is set only where the site decides it. Pass the package's `personNames` to ask
 * the values about the people that name is.
 */
export function auditTestIds(source, { personNames = [] } = {}) {
  const names = new Set(personNames.map((name) => name.toLowerCase()));
  const findings = [];
  for (const site of testIdSites(source)) {
    if (misspelled(site)) {
      findings.push({
        index: site.index,
        value: null,
        message: `test id attribute is written "${site.name}"`,
      });
      continue;
    }
    if (!site.attribute) continue;
    for (const value of [...site.owned, ...site.conditional]) {
      const verdict = valueVerdict(value, names);
      if (verdict === null) continue;
      findings.push({ index: site.index, value, message: verdict });
    }
    for (const composed of site.composed) {
      const verdict = composedVerdict(composed, names);
      if (verdict === null) continue;
      findings.push({ index: site.index, value: null, message: verdict });
    }
  }
  return findings;
}

/**
 * The values a source owns at its attribute sites, with the offset of each — the
 * set the workspace may hold only once. A value a branch may or may not render is
 * left out: the same read that excuses three states of one node in one file
 * cannot prove two of them mounted together.
 */
export function testIdValues(source) {
  return testIdSites(source).flatMap((site) =>
    site.attribute && !misspelled(site)
      ? site.owned
          .filter((value) => value.length > 0)
          .map((value) => ({ index: site.index, value }))
      : [],
  );
}

/** How many test id sites a source file renders at, for the success line. */
export function countTestIdSites(source) {
  return testIdSites(source).filter((site) => site.attribute).length;
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

/** An email's address, with the name in front of the `@` kept as a token. */
const emailAddress = /[^@\s<>]+@[^\s<>]*/gu;
/** A homepage written into the author field, whose host names no person. */
const webAddress = /[a-z][a-z0-9+.-]*:\/\/[^\s<>]*/giu;

/**
 * The people this workspace declares as its authors. A test id is published with
 * the bundle that renders it, so a name or a login reaching one is the leak
 * AGENTS.md rules out; reading the manifests means the gate asks about the people
 * actually named here instead of carrying a list nobody maintains. An author line
 * is a name plus an address, and only the name names someone: `Иван Петров
 * <ivan@example.com>` contributes `ivan` and `petrov`, because the login is what
 * a person is called, while `example` and `com` are the host's own words and must
 * not refuse an id that names no one here.
 */
async function personNames(packageDirectory) {
  const manifest = await readFile(
    join(packageDirectory, "package.json"),
    "utf8",
  )
    .then((text) => JSON.parse(text))
    .catch(() => null);
  if (manifest === null) return [];
  const declared = [manifest.author, ...(manifest.contributors ?? [])]
    .filter(Boolean)
    .flatMap((entry) => (typeof entry === "string" ? [entry] : [entry?.name]))
    .filter(Boolean);
  return [
    ...new Set(
      declared
        .join(" ")
        .replace(webAddress, " ")
        .replace(emailAddress, (address) =>
          address.slice(0, address.indexOf("@")),
        )
        .toLowerCase()
        .split(separator)
        .filter((token) => token.length >= 4),
    ),
  ];
}

/**
 * Assert every test id the workspace renders in a browser follows the #453
 * convention. Throws with the offending `path:line` list, in the shape the other
 * repository gates report failures.
 */
export async function verifyTestIds(repoRoot = workspaceRoot) {
  const findings = [];
  let sources = 0;
  let sites = 0;
  // The first file to decide a value owns it; a second one is the collision, and
  // the map spans the workspace so two packages claiming one id see each other.
  const declared = new Map();
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
      const packageDirectory = join(directory, entry.name);
      const names = await personNames(packageDirectory);
      const files = await sourceFiles(join(packageDirectory, "src"));
      for (const file of files) {
        const source = await readFile(file, "utf8");
        sources += 1;
        sites += countTestIdSites(source);
        const sourcePath = relative(repoRoot, file).split(sep).join("/");
        const lineAt = (index) => source.slice(0, index).split("\n").length;
        for (const finding of auditTestIds(source, { personNames: names })) {
          findings.push(
            `${sourcePath}:${lineAt(finding.index)}: ${finding.message}`,
          );
        }
        for (const { index, value } of testIdValues(source)) {
          const owner = declared.get(value);
          if (owner === undefined) {
            declared.set(value, { file: sourcePath, line: lineAt(index) });
          } else if (owner.file !== sourcePath) {
            findings.push(
              `${sourcePath}:${lineAt(index)}: "${value}" is also declared in ${owner.file}:${owner.line}`,
            );
          }
        }
      }
    }
  }
  if (findings.length > 0) {
    throw new Error(`test id conventions failed:\n- ${findings.join("\n- ")}`);
  }
  return { sources, sites };
}

async function main() {
  const { sources, sites } = await verifyTestIds();
  console.log(
    `test id conventions verified for ${sites} ids in ${sources} sources`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
