#!/usr/bin/env node
// Read-only leak scanner for the public dsh-plugins repository.
//
// Nothing here writes to the repository, the index or the config: it only
// enumerates files (git ls-files / rev-list), reads them and greps.
//
// Three surfaces, because the September 2026 leak lived on all three:
//   --tree     tracked + untracked-not-ignored files — what a commit publishes
//   --history  every blob reachable from any ref — what a clone publishes
//   --pack     the file list npm would pack — what the registry publishes
//
// Patterns come from three places:
//   1. the local marker dictionary, which lives OUTSIDE this repository (the
//      repository is public, so the list of what must never appear in it must
//      not appear in it either);
//   2. built-in generic packs: secrets, internal identifiers, hosts, network
//      addresses, machine paths, names;
//   3. the allowlist of synthetic values this repository deliberately uses.
//
// Usage: node leak-scan.mjs [--tree] [--history] [--pack] [--all] [options]
// Run with --help for the full list.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIRECTORY = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const DEFAULT_ALLOWLIST = path.join(SKILL_DIRECTORY, "allowlist.txt");
const MARKER_FILE_NAME = ".dsh-leak-markers.txt";
const EXTRA_ALLOWLIST_NAME = ".dsh-leak-allow.txt";
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

// --------------------------------------------------------------------------
// Generic packs
// --------------------------------------------------------------------------
// Severity `leak` means "remove before the next commit"; `review` means "a
// human must look at this line and decide". Review findings never fail the run
// unless --strict is passed, but they are always printed.

const SECRET_PATTERNS = [
  { label: "private-key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "gitlab-pat", regex: /\bglpat-[A-Za-z0-9_-]{18,}/ },
  { label: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { label: "openai-key", regex: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { label: "aws-key-id", regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: "google-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: "jwt", regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./ },
  { label: "url-credentials", regex: /https?:\/\/[^\s/@:]+:[^\s/@]+@/ },
];

// A Jira-style issue key is the classic internal identifier. The allowlist
// holds the project prefixes this repository uses as placeholders; any other
// prefix is a real tracker key until a human says otherwise. The lookarounds
// keep character classes out — `[A-Z0-9]` in a documented pattern is not a key.
const ISSUE_KEY =
  /(?<![A-Z0-9-])([A-Z][A-Z0-9]{1,9})-(\d{1,6})(?![0-9A-Za-z-])/g;
const ISSUE_KEY_ALLOWED_PREFIXES = new Set([
  "ABC",
  "ADR",
  "AES",
  "CRC",
  "DSH",
  "FIXME",
  "HTTP",
  "INV",
  "IPV",
  "ISO",
  "KEY",
  "PDF",
  "PROJ",
  "RFC",
  "SHA",
  "SM",
  "TLS",
  "UTF",
]);

// Network addresses. Documentation ranges and loopback are the repository's own
// convention and pass; a usable private address does not.
const IPV4 = /\b((?:\d{1,3}\.){3}\d{1,3})(?:\/(\d{1,2}))?\b/g;
const ALLOWED_IPV4 = new Set(["0.0.0.0", "127.0.0.1", "255.255.255.255"]);
const METADATA_IPV4 = new Set(["169.254.169.254", "100.100.100.200"]);

const URL_PATTERN = /https?:\/\/(?:[^\s/@:]+:[^\s/@]*@)?([A-Za-z0-9._~%-]+)/g;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
// An address literal in a URL belongs to the address pack, not the host pack.
const NETWORK_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/;

// Machine paths. A path inside the repository is fine; a path that points at a
// working machine — its user profile, a checkout outside the repo, a share — is
// not. Escaped source-code patterns (`\\.__ModuleLoader__`) must not match, so
// every segment starts with a letter or digit.
const MACHINE_PATH =
  /(?:^|[^\w\\/])((?:\/e\/[^\s"'`)<>\]]+)|(?:[A-Za-z]:[\\/](?:repos|worktrees|projects|dev)[\\/][^\s"'`)<>\]]*)|(?:[\\/]{1,2}Users[\\/][^\s"'`)<>\]]*)|(?:\\\\[A-Za-z0-9_-]{2,}[\\/][A-Za-z0-9_$.-]{2,}))/g;
const SYSTEM_PATH_SEGMENTS = new Set([
  "administrator",
  "dev",
  "developer",
  "example",
  "guest",
  "me",
  "public",
  "runner",
  "someone",
  "user",
  "username",
]);

// Two Cyrillic words in a row is how a person's name looks; the allowlist holds
// the invented names the fixtures use. `\b` cannot be used here — JavaScript
// treats Cyrillic as a non-word character, so the boundary never matches.
const CYRILLIC_NAME =
  /(?<![А-Яа-яЁёA-Za-z])([А-ЯЁ][а-яё]{2,})[ \t]+([А-ЯЁ][а-яё]{3,})(?![А-Яа-яЁё])/gu;

const SURFACE_PATTERNS = [
  { label: "test-tree", regex: /^tests?\// },
  // Prose shipping in a package is what carried the September 2026 leak into
  // the registry tarball; README images are ordinary assets and pass.
  { label: "docs-prose", regex: /^docs?\/.*\.md$/ },
  { label: "source-tree", regex: /^src\// },
  // Declared types are shipped on purpose; TypeScript sources are not.
  { label: "typescript-source", regex: /(?<!\.d)\.tsx?$/ },
  { label: "source-snapshot", regex: /\.(env|pem|key|p12|pfx)$/ },
];

// --------------------------------------------------------------------------
// Argument parsing
// --------------------------------------------------------------------------

function parseArguments(argv) {
  const options = {
    modes: [],
    repo: null,
    markers: null,
    allow: null,
    json: false,
    hosts: "dotted",
    refs: true,
    strict: false,
    quiet: false,
    only: [],
    maxBytes: DEFAULT_MAX_BYTES,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${argument} needs a value`);
      }
      return argv[index];
    };
    switch (argument) {
      case "--tree":
      case "--history":
      case "--pack":
        options.modes.push(argument.slice(2));
        break;
      case "--all":
        options.modes.push("tree", "history", "pack");
        break;
      case "--repo":
        options.repo = value();
        break;
      case "--markers":
        options.markers = value();
        break;
      case "--allow":
        options.allow = value();
        break;
      case "--only":
        options.only.push(value().split(path.sep).join("/"));
        break;
      case "--max-bytes":
        options.maxBytes = Number(value());
        break;
      case "--json":
        options.json = true;
        break;
      case "--hosts":
        options.hosts = value();
        break;
      case "--no-refs":
        options.refs = false;
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument ${argument}`);
    }
  }
  if (options.modes.length === 0) {
    options.modes.push("tree");
  }
  return options;
}

const HELP = `leak-scan — read-only leak scanner for the public dsh-plugins repository

Modes (default --tree):
  --tree              tracked + untracked-not-ignored files
  --history           every blob reachable from every ref
  --pack              the file list npm would pack, per publishable package
  --all               all three

Options:
  --repo <dir>        repository to scan (default: current directory)
  --markers <file>    marker dictionary (default: $LEAK_MARKERS, then
                      <repo>/${MARKER_FILE_NAME}, then ~/${MARKER_FILE_NAME})
  --allow <file>      extra allowlist on top of the skill's allowlist.txt
  --only <prefix>     limit the scan to paths under this prefix (repeatable)
  --max-bytes <n>     skip files larger than n bytes (default ${DEFAULT_MAX_BYTES})
  --hosts dotted|all  report dotted hosts only, or local service names too
  --no-refs           skip resolving which refs still reach a leaked blob
  --strict            exit non-zero on review findings too
  --json              machine-readable report
  --quiet             print the summary only
`;

// --------------------------------------------------------------------------
// Loading markers and allowlist
// --------------------------------------------------------------------------

function readLines(filePath) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Marker file format, one entry per line:
//   value            literal, case-sensitive
//   regex:<pattern>  regular expression
//   noisy:value      literal, reported as review instead of leak
//   noisy-regex:<p>  regular expression, reported as review
// Short ASCII markers get word boundaries so that they cannot match inside a
// hash or a longer word; longer ones are matched as substrings on purpose,
// because a leak can sit in the middle of an identifier.
function loadMarkers(filePath) {
  const markers = [];
  if (!filePath) {
    return markers;
  }
  for (const line of readLines(filePath)) {
    let severity = "leak";
    let source = line;
    if (source.startsWith("noisy-regex:")) {
      severity = "review";
      source = source.slice("noisy-regex:".length);
    } else if (source.startsWith("noisy:")) {
      severity = "review";
      source = source.slice("noisy:".length);
    } else if (source.startsWith("regex:")) {
      source = source.slice("regex:".length);
    } else if (/^[A-Za-z0-9_.-]+$/.test(source) && source.length < 6) {
      source = `(?<![A-Za-z0-9_])${escapeRegExp(source)}(?![A-Za-z0-9_])`;
    } else {
      source = escapeRegExp(source);
    }
    markers.push({ label: "marker", severity, regex: new RegExp(source, "u") });
  }
  return markers;
}

// Case variants of a marker are the classic miss: a replacement dictionary is
// case-sensitive, so a lowercase mention survives the sweep. Only single-token
// letter markers are checked — a CamelCase identifier such as
// `SomeInternalService` is reported once, its fully lowercase form is noise.
function caseVariantWarnings(filePath) {
  if (!filePath) {
    return [];
  }
  const literals = readLines(filePath)
    .filter((line) => !/^(noisy-)?regex:/.test(line))
    .map((line) => line.replace(/^noisy:/, ""));
  const known = new Set(literals);
  const missing = [];
  for (const value of literals) {
    if (!/^[A-Za-z]+$/.test(value)) {
      continue;
    }
    const lowered = value.toLowerCase();
    if (lowered !== value && !known.has(lowered)) {
      missing.push(`${value} (${lowered})`);
    }
  }
  if (missing.length === 0) {
    return [];
  }
  const shown = missing.slice(0, 5).join(", ");
  const rest = missing.length > 5 ? `, +${missing.length - 5} more` : "";
  return [
    `markers: ${missing.length} literal(s) without a lowercase twin: ${shown}${rest}`,
  ];
}

function loadAllowlist(...filePaths) {
  const entries = [];
  for (const filePath of filePaths) {
    if (!filePath || !existsSync(filePath)) {
      continue;
    }
    for (const line of readLines(filePath)) {
      if (line.startsWith("re:")) {
        entries.push({ kind: "regex", value: new RegExp(line.slice(3), "u") });
      } else if (line.startsWith("*.")) {
        entries.push({ kind: "suffix", value: line.slice(1) });
      } else {
        entries.push({ kind: "exact", value: line });
      }
    }
  }
  return entries;
}

function isAllowed(entries, value) {
  const lowered = value.toLowerCase();
  return entries.some((entry) => {
    if (entry.kind === "exact") {
      return entry.value.toLowerCase() === lowered;
    }
    if (entry.kind === "suffix") {
      return lowered.endsWith(entry.value.toLowerCase());
    }
    return entry.value.test(value);
  });
}

// --------------------------------------------------------------------------
// Scanning a text
// --------------------------------------------------------------------------

function addFinding(findings, finding) {
  findings.push(finding);
}

function mask(value) {
  if (value.length <= 12) {
    return `${value.slice(0, 2)}…(${value.length})`;
  }
  return `${value.slice(0, 8)}…(${value.length})`;
}

function scanLine(context, line, lineNumber) {
  const { findings, markerRules, allowlist } = context;

  for (const rule of markerRules) {
    const match = rule.regex.exec(line);
    if (match) {
      addFinding(findings, {
        severity: rule.severity,
        pack: "marker",
        rule: "marker",
        file: context.file,
        line: lineNumber,
        text: match[0],
      });
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.regex.exec(line);
    if (match && !isAllowed(allowlist, match[0])) {
      addFinding(findings, {
        severity: "leak",
        pack: "secret",
        rule: pattern.label,
        file: context.file,
        line: lineNumber,
        text: mask(match[0]),
      });
    }
  }

  ISSUE_KEY.lastIndex = 0;
  let issue = ISSUE_KEY.exec(line);
  while (issue) {
    if (
      !ISSUE_KEY_ALLOWED_PREFIXES.has(issue[1]) &&
      !isAllowed(allowlist, issue[0])
    ) {
      addFinding(findings, {
        severity: "leak",
        pack: "identifier",
        rule: "issue-key",
        file: context.file,
        line: lineNumber,
        text: issue[0],
      });
    }
    issue = ISSUE_KEY.exec(line);
  }

  IPV4.lastIndex = 0;
  let address = IPV4.exec(line);
  while (address) {
    const value = address[1];
    const inCidr = address[2] !== undefined;
    const privateAddress =
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
        value,
      );
    if (
      privateAddress &&
      !inCidr &&
      !ALLOWED_IPV4.has(value) &&
      !METADATA_IPV4.has(value) &&
      !isAllowed(allowlist, value)
    ) {
      // A reachable private address is what leaked in September 2026, and the
      // specific one is a hard marker; a bare address is most often SSRF test
      // data, so it stays a review item rather than a red alarm.
      addFinding(findings, {
        severity: "review",
        pack: "address",
        rule: "private-address",
        file: context.file,
        line: lineNumber,
        text: value,
      });
    }
    address = IPV4.exec(line);
  }

  URL_PATTERN.lastIndex = 0;
  let url = URL_PATTERN.exec(line);
  while (url) {
    const host = url[1].toLowerCase();
    // A host without a dot is a local service name (`http://docling:5001`), and
    // reporting them buries the dotted hosts that actually identify a system.
    // --hosts all brings them back for a thorough sweep.
    const singleLabel = !host.includes(".") && !/^\d/.test(host);
    if (!singleLabel || context.singleLabelHosts) {
      if (!NETWORK_LITERAL.test(host) && !isAllowed(allowlist, host)) {
        addFinding(findings, {
          severity: "review",
          pack: "host",
          rule: "unknown-host",
          file: context.file,
          line: lineNumber,
          text: host,
        });
      }
    }
    url = URL_PATTERN.exec(line);
  }

  EMAIL_PATTERN.lastIndex = 0;
  let email = EMAIL_PATTERN.exec(line);
  while (email) {
    const domain = email[1].toLowerCase();
    if (!isAllowed(allowlist, domain)) {
      addFinding(findings, {
        severity: "review",
        pack: "host",
        rule: "unknown-mail-domain",
        file: context.file,
        line: lineNumber,
        text: email[0],
      });
    }
    email = EMAIL_PATTERN.exec(line);
  }

  MACHINE_PATH.lastIndex = 0;
  let machinePath = MACHINE_PATH.exec(line);
  while (machinePath) {
    const value = machinePath[1];
    const profile = /[\\/]{1,2}Users[\\/]{1,2}([^\\/\s"'`)<>\]]+)/i.exec(value);
    const syntheticProfile =
      profile && SYSTEM_PATH_SEGMENTS.has(profile[1].toLowerCase());
    if (!isAllowed(allowlist, value) && !syntheticProfile) {
      addFinding(findings, {
        severity: "review",
        pack: "path",
        rule: "machine-path",
        file: context.file,
        line: lineNumber,
        text: value,
      });
    }
    machinePath = MACHINE_PATH.exec(line);
  }

  CYRILLIC_NAME.lastIndex = 0;
  const name = CYRILLIC_NAME.exec(line);
  if (name && !isAllowed(allowlist, `${name[1]} ${name[2]}`)) {
    addFinding(findings, {
      severity: "review",
      pack: "name",
      rule: "cyrillic-name",
      file: context.file,
      line: lineNumber,
      text: `${name[1]} ${name[2]}`,
    });
  }
}

function isTextual(buffer) {
  const probe = buffer.subarray(0, 8000);
  return !probe.includes(0);
}

function scanText(context, text, findings = []) {
  const local = { ...context, findings };
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    scanLine(local, lines[index], index + 1);
  }
  return findings;
}

// --------------------------------------------------------------------------
// Modes
// --------------------------------------------------------------------------

function git(repo, args, options = {}) {
  // `encoding: "buffer"` is what the callers ask for; Node wants `null`, and it
  // rejects the string form outright once `input` is present.
  const encoding =
    options.encoding === "buffer" ? null : (options.encoding ?? "utf8");
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding,
    maxBuffer: options.maxBuffer ?? 512 * 1024 * 1024,
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.tolerateFailure) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function resolveRepository(options) {
  if (options.repo) {
    return path.resolve(options.repo);
  }
  return path.resolve(
    git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim(),
  );
}

function pathFilter(options, relativePath) {
  if (options.only.length === 0) {
    return true;
  }
  return options.only.some((prefix) => relativePath.startsWith(prefix));
}

function listTreeFiles(repo, options) {
  const raw = git(
    repo,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "buffer",
    },
  );
  return raw
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry.length > 0)
    .filter((entry) => pathFilter(options, entry));
}

function scanTree(repo, options, context) {
  const findings = [];
  const files = listTreeFiles(repo, options);
  const stats = { files: 0, skippedBinary: 0, skippedLarge: 0 };
  for (const relativePath of files) {
    const absolute = path.join(repo, relativePath);
    let buffer;
    try {
      buffer = readFileSync(absolute);
    } catch {
      continue;
    }
    if (buffer.length > options.maxBytes) {
      stats.skippedLarge += 1;
      continue;
    }
    if (!isTextual(buffer)) {
      stats.skippedBinary += 1;
      continue;
    }
    stats.files += 1;
    scanText(
      { ...context, file: relativePath },
      buffer.toString("utf8"),
      findings,
    );
  }
  return { findings, stats };
}

function scanHistory(repo, options, context) {
  const findings = [];
  const objectList = git(repo, ["rev-list", "--objects", "--all"]);
  const paths = new Map();
  const hashes = [];
  for (const line of objectList.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const separator = line.indexOf(" ");
    const hash = separator === -1 ? line : line.slice(0, separator);
    const objectPath = separator === -1 ? "" : line.slice(separator + 1);
    if (objectPath && !paths.has(hash) && pathFilter(options, objectPath)) {
      paths.set(hash, objectPath);
      hashes.push(hash);
    }
  }
  const stats = {
    blobs: 0,
    skippedBinary: 0,
    skippedLarge: 0,
    candidates: hashes.length,
  };
  if (hashes.length === 0) {
    return { findings, stats };
  }
  const output = git(repo, ["cat-file", "--batch"], {
    encoding: "buffer",
    input: `${hashes.join("\n")}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  let position = 0;
  while (position < output.length) {
    const headerEnd = output.indexOf(0x0a, position);
    if (headerEnd === -1) {
      break;
    }
    const header = output.subarray(position, headerEnd).toString("utf8");
    const [hash, type, sizeText] = header.split(" ");
    const size = Number(sizeText);
    const contentStart = headerEnd + 1;
    if (!Number.isFinite(size)) {
      break;
    }
    const content = output.subarray(contentStart, contentStart + size);
    position = contentStart + size + 1;
    if (type !== "blob") {
      continue;
    }
    if (size > options.maxBytes) {
      stats.skippedLarge += 1;
      continue;
    }
    if (!isTextual(content)) {
      stats.skippedBinary += 1;
      continue;
    }
    stats.blobs += 1;
    const before = findings.length;
    scanText(
      { ...context, file: `${paths.get(hash) ?? "?"} @${hash.slice(0, 8)}` },
      content.toString("utf8"),
      findings,
    );
    for (let index = before; index < findings.length; index += 1) {
      findings[index].blob = hash;
    }
  }
  return { findings, stats };
}

// Which refs still reach a given blob. This is the question that matters after
// a history rewrite: the published branch may be clean while a local branch,
// tag, `refs/codex/*` or the stash still walks straight into the old objects,
// and a `git push --all` or a new worktree branched off them republishes them.
function buildBlobRefIndex(repo) {
  const tips = new Map();
  for (const line of git(repo, [
    "for-each-ref",
    "--format=%(objectname) %(refname)",
  ]).split("\n")) {
    const separator = line.indexOf(" ");
    if (separator === -1) {
      continue;
    }
    const sha = line.slice(0, separator);
    const refname = line.slice(separator + 1);
    if (!tips.has(sha)) {
      tips.set(sha, []);
    }
    tips.get(sha).push(refname);
  }
  const index = new Map();
  for (const [sha, refnames] of tips) {
    for (const line of git(repo, ["rev-list", "--objects", sha], {
      tolerateFailure: true,
    }).split("\n")) {
      const separator = line.indexOf(" ");
      if (separator === -1) {
        continue;
      }
      const blob = line.slice(0, separator);
      if (!index.has(blob)) {
        index.set(blob, new Set());
      }
      for (const refname of refnames) {
        index.get(blob).add(refname);
      }
    }
  }
  return index;
}

function publishablePackages(repo) {
  const packages = [];
  for (const parent of ["plugins", "packages"]) {
    const parentDirectory = path.join(repo, parent);
    if (!existsSync(parentDirectory)) {
      continue;
    }
    for (const entry of readdirSync(parentDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(
        parentDirectory,
        entry.name,
        "package.json",
      );
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (!manifest.name || manifest.private) {
        continue;
      }
      packages.push({ directory: path.join(parent, entry.name), manifest });
    }
  }
  return packages;
}

function scanPack(repo, options, context) {
  const findings = [];
  const stats = { packages: 0, files: 0, missing: 0 };
  for (const entry of publishablePackages(repo)) {
    // npm is a shell shim on Windows, so it needs a shell; the command is a
    // constant, which keeps the unescaped-argument warning moot.
    const result = spawnSync("npm pack --dry-run --json --ignore-scripts", {
      cwd: path.join(repo, entry.directory),
      encoding: "utf8",
      shell: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      addFinding(findings, {
        severity: "review",
        pack: "surface",
        rule: "pack-failed",
        file: entry.directory,
        line: 0,
        text: (result.error?.message || result.stderr || "npm pack failed")
          .trim()
          .split("\n")
          .pop(),
      });
      continue;
    }
    let report;
    try {
      report = JSON.parse(result.stdout)[0];
    } catch {
      continue;
    }
    stats.packages += 1;
    for (const file of report.files ?? []) {
      const relativePath = file.path;
      for (const pattern of SURFACE_PATTERNS) {
        if (pattern.regex.test(relativePath)) {
          addFinding(findings, {
            severity: "review",
            pack: "surface",
            rule: `packed-${pattern.label}`,
            file: `${entry.manifest.name}:${relativePath}`,
            line: 0,
            text: `${file.size} bytes`,
          });
          break;
        }
      }
      const absolute = path.join(repo, entry.directory, relativePath);
      if (!existsSync(absolute)) {
        stats.missing += 1;
        continue;
      }
      const buffer = readFileSync(absolute);
      if (buffer.length > options.maxBytes || !isTextual(buffer)) {
        continue;
      }
      stats.files += 1;
      scanText(
        { ...context, file: `${entry.manifest.name}:${relativePath}` },
        buffer.toString("utf8"),
        findings,
      );
    }
  }
  return { findings, stats };
}

// --------------------------------------------------------------------------
// Reporting
// --------------------------------------------------------------------------

function sortFindings(findings) {
  const order = { leak: 0, review: 1 };
  return findings.sort((left, right) => {
    if (order[left.severity] !== order[right.severity]) {
      return order[left.severity] - order[right.severity];
    }
    if (left.file !== right.file) {
      return left.file < right.file ? -1 : 1;
    }
    return left.line - right.line;
  });
}

function describeStats(mode, stats) {
  if (mode === "tree") {
    return `${stats.files} files scanned (${stats.skippedBinary} binary, ${stats.skippedLarge} oversized skipped)`;
  }
  if (mode === "history") {
    return `${stats.blobs} blobs scanned of ${stats.candidates} objects (${stats.skippedBinary} binary, ${stats.skippedLarge} oversized skipped)`;
  }
  return `${stats.packages} packages, ${stats.files} packed files scanned (${stats.missing} not built on disk)`;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const repo = resolveRepository(options);
  const markerCandidates = [
    options.markers,
    process.env.LEAK_MARKERS,
    path.join(repo, MARKER_FILE_NAME),
    path.join(homedir(), MARKER_FILE_NAME),
  ].filter(Boolean);
  const markerFile =
    markerCandidates.find((candidate) => existsSync(candidate)) ?? null;
  const markerRules = loadMarkers(markerFile);
  const allowlistFiles = [
    DEFAULT_ALLOWLIST,
    options.allow,
    process.env.LEAK_ALLOW,
    path.join(repo, EXTRA_ALLOWLIST_NAME),
  ].filter(Boolean);
  const allowlist = loadAllowlist(...allowlistFiles);
  const warnings = caseVariantWarnings(markerFile);

  const context = {
    markerRules,
    allowlist,
    singleLabelHosts: options.hosts === "all",
  };
  const report = { repo, markerFile, modes: {}, findings: [], warnings };
  for (const mode of [...new Set(options.modes)]) {
    const result =
      mode === "tree"
        ? scanTree(repo, options, context)
        : mode === "history"
          ? scanHistory(repo, options, context)
          : scanPack(repo, options, context);
    report.modes[mode] = result.stats;
    for (const finding of result.findings) {
      report.findings.push({ ...finding, mode });
    }
  }
  sortFindings(report.findings);
  const leaks = report.findings.filter(
    (finding) => finding.severity === "leak",
  );
  const reviews = report.findings.filter(
    (finding) => finding.severity === "review",
  );

  // Attribution runs only when there is something to attribute, and only for
  // findings that came out of history mode. The summary list counts leak
  // findings alone: a review-level host notice must not make a clean branch
  // look like it still reaches leaked content.
  const blamed = report.findings.filter((finding) => finding.blob);
  if (options.refs && blamed.length > 0) {
    const index = buildBlobRefIndex(repo);
    const refs = new Set();
    for (const finding of blamed) {
      const holders = [...(index.get(finding.blob) ?? [])].sort();
      finding.refs = holders;
      if (finding.severity !== "leak") {
        continue;
      }
      for (const refname of holders) {
        refs.add(refname);
      }
    }
    report.refs = [...refs].sort();
  }

  const formatRefs = (finding) => {
    if (!finding.refs || finding.refs.length === 0) {
      return "";
    }
    const shown = finding.refs.slice(0, 3).join(", ");
    const rest = finding.refs.length > 3 ? ` +${finding.refs.length - 3}` : "";
    return `  [${shown}${rest}]`;
  };

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ ...report, summary: { leaks: leaks.length, reviews: reviews.length } }, null, 2)}\n`,
    );
  } else {
    const lines = [];
    lines.push(`leak-scan · repo ${repo}`);
    lines.push(
      markerFile
        ? `markers: ${markerFile} (${markerRules.length} patterns)`
        : `markers: none found — expected $LEAK_MARKERS, ${MARKER_FILE_NAME} in the repo root or in ${homedir()}`,
    );
    lines.push(
      `allowlist: ${allowlist.length} patterns from ${allowlistFiles.join(", ")}`,
    );
    for (const mode of Object.keys(report.modes)) {
      lines.push(`${mode}: ${describeStats(mode, report.modes[mode])}`);
    }
    for (const warning of warnings) {
      lines.push(`warn  ${warning}`);
    }
    if (!options.quiet) {
      if (report.findings.length > 0) {
        lines.push("");
        lines.push(
          "! the lines below carry the leaked values — never paste this report outside the machine",
        );
      }
      for (const finding of report.findings) {
        const location =
          finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
        lines.push(
          `${finding.severity.toUpperCase().padEnd(6)} ${location}  ${finding.rule}  ${finding.text}${formatRefs(finding)}`,
        );
      }
    }
    if (report.refs && report.refs.length > 0) {
      lines.push("");
      lines.push(`refs still reaching leaked content (${report.refs.length}):`);
      for (const refname of report.refs) {
        lines.push(`  ${refname}`);
      }
    }
    lines.push("");
    lines.push(`summary: ${leaks.length} leak, ${reviews.length} review`);
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  const failed = leaks.length > 0 || (options.strict && reviews.length > 0);
  process.exit(failed ? 1 : 0);
}

main();
