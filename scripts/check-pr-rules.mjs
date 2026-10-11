/**
 * Local revision-range checks complement the package/build gates. No forge API,
 * labels, PR readiness heuristics, client parser or duplicate shell policy.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBase } from "./check-release-plans.mjs";
import { planProjects } from "./qa-changelog-contract.mjs";
import { identifierFindings } from "./pr-identifier-rules.mjs";

const qaProject = "@yadsh/dsh-qa-surface";
const qaChangelog =
  "plugins/dsh-qa-surface/src/client/components/QaChangelog.tsx";
const exemptPrefixes = ["qa-deploy/", "qa-deploy-docker/", ".portable/"];
const textFile =
  /\.(?:[cm]?[jt]sx?|css|scss|json|md|markdown|ya?ml|toml|txt|sh|ps1|html|sql|ini|hbs|diff|patch|po|pot)$/iu;
const locks = /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/u;
const manifestPath = /^(?:plugins|packages|tooling)\/[^/]+\/package\.json$/u;

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commitRef(repoRoot, ref) {
  try {
    return git(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`"${ref}" is not a commit this repository can resolve`);
  }
}

export function addedLines(diff) {
  const added = [];
  let line;
  for (const row of diff.split(/\r?\n/u)) {
    if (row.startsWith("diff --git ")) {
      line = undefined;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(row);
    if (hunk !== null) {
      line = Number(hunk[1]);
      continue;
    }
    if (line === undefined || row.startsWith("\\")) continue;
    if (row.startsWith("+")) {
      added.push({ line, text: row.slice(1) });
      line += 1;
    } else if (row.startsWith(" ")) line += 1;
  }
  return added;
}

function bundleUrlFindings(text, packageNames) {
  return [...text.matchAll(/\/plugins\/([^"'\s`]+?)\/client\.js/gu)]
    .filter((match) => !/^[<$]/u.test(match[1]) && !packageNames.has(match[1]))
    .map(() => ({
      rule: "client-bundle-path",
      message:
        "fetch client.js using the full npm package name, preserving its scoped path",
    }));
}

/** Attribute version edits individually: one release commit cannot mask later edits. */
function manualVersionChange(repoRoot, base, head, file, before, after) {
  if (before.version === after.version || after.private === true) return false;
  const commits = git(repoRoot, [
    "log",
    "--format=%H",
    `${base}..${head}`,
    "--",
    file,
  ])
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const commit of commits) {
    const parents = git(repoRoot, ["rev-list", "--parents", "-n", "1", commit])
      .trim()
      .split(" ")
      .slice(1);
    if (parents.length === 0) continue;
    const next = JSON.parse(git(repoRoot, ["show", `${commit}:${file}`]));
    const parentFiles = git(repoRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      parents[0],
      "--",
      file,
    ]).trim();
    if (parentFiles === "") continue; // A new package declares its initial version.
    const previous = JSON.parse(
      git(repoRoot, ["show", `${parents[0]}:${file}`]),
    );
    if (next.version === previous.version) continue;
    if (
      !/^chore\(release\):/u.test(
        git(repoRoot, ["show", "-s", "--format=%s", commit]),
      )
    )
      return true;
  }
  return false;
}

export function inspectRange({
  repoRoot = process.cwd(),
  base,
  head = "HEAD",
  names = [],
}) {
  const baseCommit = commitRef(repoRoot, base);
  const headCommit = commitRef(repoRoot, head);
  const start = git(repoRoot, ["merge-base", baseCommit, headCommit]).trim();
  const treeFiles = new Set(
    git(repoRoot, ["ls-tree", "-r", "-z", "--name-only", headCommit])
      .split("\0")
      .filter(Boolean),
  );
  const baseFiles = new Set(
    git(repoRoot, ["ls-tree", "-r", "-z", "--name-only", start])
      .split("\0")
      .filter(Boolean),
  );
  const changed = git(repoRoot, [
    "diff",
    "--no-renames",
    "--name-only",
    "-z",
    start,
    headCommit,
  ])
    .split("\0")
    .filter(Boolean);
  const packageNames = new Set(
    [...treeFiles]
      .filter((file) => manifestPath.test(file))
      .map(
        (file) =>
          JSON.parse(git(repoRoot, ["show", `${headCommit}:${file}`])).name,
      ),
  );
  const findings = [];
  let namesChecked = 0;
  for (const file of changed) {
    if (
      !treeFiles.has(file) ||
      !textFile.test(file) ||
      locks.test(file) ||
      exemptPrefixes.some((prefix) => file.startsWith(prefix))
    )
      continue;
    const lines = addedLines(
      git(repoRoot, [
        "diff",
        "--no-ext-diff",
        "--no-renames",
        "--unified=0",
        start,
        headCommit,
        "--",
        file,
      ]),
    );
    namesChecked += 1;
    for (const line of lines) {
      findings.push(
        ...identifierFindings(line.text, { names }).map((finding) => ({
          file,
          line: line.line,
          ...finding,
        })),
      );
      if (/\.[cm]?[jt]sx?$/u.test(file))
        findings.push(
          ...bundleUrlFindings(line.text, packageNames).map((finding) => ({
            file,
            line: line.line,
            ...finding,
          })),
        );
    }
    const source = git(repoRoot, ["show", `${headCommit}:${file}`]);
    if (
      file.startsWith(".nx/version-plans/") &&
      file.endsWith(".md") &&
      planProjects(source).includes(qaProject) &&
      !changed.includes(qaChangelog)
    ) {
      findings.push({
        file,
        line: 1,
        rule: "qa-changelog-pair",
        message:
          "a changed qa-surface version plan must update QaChangelog.tsx in the same change",
      });
    }
    if (manifestPath.test(file) && baseFiles.has(file)) {
      const before = JSON.parse(git(repoRoot, ["show", `${start}:${file}`]));
      const after = JSON.parse(source);
      if (manualVersionChange(repoRoot, start, headCommit, file, before, after))
        findings.push({
          file,
          line: 1,
          rule: "manual-version-bump",
          message:
            "Nx materializes package versions during release; remove the manual manifest bump",
        });
    }
  }
  return { base: start, head: headCommit, files: namesChecked, findings };
}

export function main(argv = process.argv.slice(2), repoRoot = process.cwd()) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    process.stdout.write(
      "usage: node scripts/check-pr-rules.mjs [--base=<ref>] [--head=<ref>] [--names-file=<private-path>]\n",
    );
    return 0;
  }
  try {
    const options = {};
    for (const argument of argv) {
      const match = /^--(base|head|names-file)=(.+)$/u.exec(argument);
      if (match === null || options[match[1]] !== undefined)
        throw new Error(`invalid or duplicate argument ${argument}`);
      options[match[1]] = match[2];
    }
    const names =
      options["names-file"] === undefined
        ? []
        : readFileSync(options["names-file"], "utf8")
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter((line) => line !== "" && !line.startsWith("#"));
    const result = inspectRange({
      repoRoot,
      base: resolveBase(repoRoot, options.base ?? process.env.NX_BASE),
      head: options.head ?? process.env.NX_HEAD ?? "HEAD",
      names,
    });
    for (const finding of result.findings)
      process.stderr.write(
        `${finding.file}:${finding.line}: [${finding.rule}] ${finding.message}\n`,
      );
    process.stdout.write(
      `PR rules: ${result.files} changed text file(s), ${result.findings.length} violation(s) in ${result.base}..${result.head}; private names ${names.length === 0 ? "NOT checked (no names supplied)" : "checked"}\n`,
    );
    return result.findings.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`PR rules: ${error.message}\n`);
    return 2;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  process.exitCode = main();
