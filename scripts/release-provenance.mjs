import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseRows } from "./verify-package-publication.mjs";

const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function git(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    // A remote error can include a credential-bearing URL. Report the operation.
    throw new Error(`Release provenance: git ${args[0]} failed`);
  }
}

function checkRef(root, ref) {
  if (typeof ref !== "string" || !/^refs\/(heads|tags)\//u.test(ref))
    throw new Error("Release ref must be a full branch or tag ref");
  git(root, ["check-ref-format", ref]);
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error("Release has no selected packages");
  const names = new Set();
  const files = new Set();
  for (const row of rows) {
    if (
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(row.name ?? "") ||
      !/^[0-9][0-9A-Za-z.+-]*$/u.test(row.version ?? "") ||
      !/^(plugins|packages)\/[a-z0-9._-]+$/iu.test(row.directory ?? "")
    )
      throw new Error("Invalid release package identity");
    const expected = `${row.name.replace(/^@/u, "").replaceAll("/", "-")}-${row.version}.tgz`;
    if (
      row.tarball !== expected ||
      names.has(row.name) ||
      files.has(row.tarball)
    )
      throw new Error("Invalid or duplicate release tarball identity");
    names.add(row.name);
    files.add(row.tarball);
  }
}

/** Recovery publishes only versions tied to this exact tagged source commit. */
export function selectTaggedRows(root, rows) {
  const tags = git(root, ["tag", "--points-at", "HEAD"])
    .split(/\r?\n/u)
    .filter(Boolean);
  const wave = tags.filter((tag) => tag.startsWith("release/")).sort()[0];
  if (wave) {
    const changed = new Set(
      git(root, [
        "diff",
        "--name-only",
        "--diff-filter=AM",
        "HEAD^",
        "HEAD",
        "--",
        "plugins/*/package.json",
        "packages/*/package.json",
      ]).split(/\r?\n/u),
    );
    return {
      rows: rows.filter((row) => changed.has(`${row.directory}/package.json`)),
      tags: [`refs/tags/${wave}`],
    };
  }
  const selected = rows.filter((row) =>
    tags.includes(`${row.name}@${row.version}`),
  );
  return {
    rows: selected,
    tags: selected.map((row) => `refs/tags/${row.name}@${row.version}`),
  };
}

export function createReleasePlan(
  root,
  { baseSha, ref, rows, publishOnly = false },
) {
  checkRef(root, ref);
  if (!oid.test(baseSha)) throw new Error("Invalid release base commit");
  if (!publishOnly && !ref.startsWith("refs/heads/"))
    throw new Error(
      "A normal release must be dispatched on a branch; use publish_only on an existing release tag",
    );
  const head = git(root, ["rev-parse", "HEAD"]);
  git(root, ["merge-base", "--is-ancestor", baseSha, head]);
  if (publishOnly && head !== baseSha)
    throw new Error("Recovery must use the exact dispatched commit");
  const selection = publishOnly
    ? selectTaggedRows(root, rows)
    : { rows, tags: [] };
  validateRows(selection.rows);
  if (publishOnly)
    process.stderr.write(
      `publish_only: ${selection.rows.length} package(s) tagged at the selected commit; ${rows.length - selection.rows.length} other version(s) excluded. Dispatch their own release tag to recover them.\n`,
    );
  return {
    version: 1,
    baseSha,
    ref,
    tree: git(root, ["rev-parse", "HEAD^{tree}"]),
    preparedCommit: head,
    publishOnly,
    rows: selection.rows,
    tags: selection.tags,
  };
}

export function loadReleasePlan(file, expectedDigest) {
  const bytes = readFileSync(file);
  if (
    !/^[a-f0-9]{64}$/u.test(expectedDigest ?? "") ||
    hash(bytes) !== expectedDigest
  )
    throw new Error("Release plan digest mismatch");
  const plan = JSON.parse(bytes);
  if (
    plan.version !== 1 ||
    !oid.test(plan.baseSha) ||
    !oid.test(plan.tree) ||
    !oid.test(plan.preparedCommit) ||
    typeof plan.publishOnly !== "boolean" ||
    !Array.isArray(plan.tags)
  )
    throw new Error("Invalid release plan");
  validateRows(plan.rows);
  return plan;
}

export function assertReleaseTree(root, plan) {
  if (git(root, ["rev-parse", "HEAD^{tree}"]) !== plan.tree)
    throw new Error("Release source tree differs from the prepared tree");
  git(root, ["merge-base", "--is-ancestor", plan.baseSha, "HEAD"]);
  if (plan.publishOnly && git(root, ["rev-parse", "HEAD"]) !== plan.baseSha)
    throw new Error("Recovery source commit differs from the selected tag");
  // pnpm can make tracked bin files executable; only their content matters.
  git(root, ["-c", "core.filemode=false", "diff", "--quiet", "HEAD", "--"]);
}

/** Both lightweight and annotated tags are compared by their target commit. */
export function assertRemoteBase(
  root,
  plan,
  { remote = "origin", afterPublication = false } = {},
) {
  const refs = [...new Set([plan.ref, ...plan.tags])];
  for (const ref of refs) checkRef(root, ref);
  const records = new Map(
    git(root, [
      "ls-remote",
      remote,
      ...refs.flatMap((ref) => [ref, `${ref}^{}`]),
    ])
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        const [sha, ref] = line.split(/\s+/u);
        return [ref, sha];
      }),
  );
  for (const ref of refs) {
    if ((records.get(`${ref}^{}`) ?? records.get(ref)) !== plan.baseSha) {
      throw new Error(
        `Release ref ${ref} advanced or disappeared. ${afterPublication ? "npm may already contain this wave; do not rerun from a new branch head. Recover the prepared tree and original verified tarballs from this run's artifacts, or issue a new version. No release tag will be pushed." : "This attempt stopped before npm publish. Check earlier attempts and the planned versions on npm before dispatching a new release. Retain the original plan and verified tarballs for recovery."}`,
      );
    }
  }
}

/** Called only after every tarball verification gate succeeded. */
export function exportVerifiedTarball(file, directory) {
  if (!file.endsWith(".tgz") || !lstatSync(file).isFile())
    throw new Error("Verified artifact must be a regular .tgz file");
  mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, path.basename(file));
  copyFileSync(file, destination, constants.COPYFILE_EXCL);
  return destination;
}

function fingerprint(file) {
  if (!lstatSync(file).isFile())
    throw new Error("Release artifact must be a regular file");
  const bytes = readFileSync(file);
  return {
    size: bytes.length,
    sha256: hash(bytes),
    integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
  };
}

export function recordArtifact(root, plan, planDigest, directory, tarballs) {
  assertReleaseTree(root, plan);
  const row = plan.rows.find((item) => item.directory === directory);
  if (!row)
    throw new Error("Package is not selected by the prepared release plan");
  const manifest = JSON.parse(
    readFileSync(path.join(root, directory, "package.json"), "utf8"),
  );
  if (manifest.name !== row.name || manifest.version !== row.version)
    throw new Error("Package identity differs from the release plan");
  const record = {
    version: 1,
    planDigest,
    baseSha: plan.baseSha,
    tree: plan.tree,
    ...row,
    ...fingerprint(path.join(tarballs, row.tarball)),
  };
  writeFileSync(
    path.join(tarballs, `${row.tarball}.provenance.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    { flag: "wx" },
  );
  return record;
}

export function verifyArtifacts(root, plan, planDigest, tarballs) {
  assertReleaseTree(root, plan);
  const expectedFiles = plan.rows
    .flatMap((row) => [row.tarball, `${row.tarball}.provenance.json`])
    .sort();
  if (
    JSON.stringify(readdirSync(tarballs).sort()) !==
    JSON.stringify(expectedFiles)
  )
    throw new Error(
      "Release artifacts do not exactly match the selected package set",
    );
  return plan.rows.map((row) => {
    const record = JSON.parse(
      readFileSync(
        path.join(tarballs, `${row.tarball}.provenance.json`),
        "utf8",
      ),
    );
    const expected = {
      version: 1,
      planDigest,
      baseSha: plan.baseSha,
      tree: plan.tree,
      ...row,
      ...fingerprint(path.join(tarballs, row.tarball)),
    };
    for (const [key, value] of Object.entries(expected)) {
      if (record[key] !== value)
        throw new Error(
          `Release artifact provenance mismatch for ${row.name}: ${key}`,
        );
    }
    return record;
  });
}

export async function registryIntegrity(row, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(
    `https://registry.npmjs.org/${encodeURIComponent(row.name)}/${encodeURIComponent(row.version)}`,
    { signal: globalThis.AbortSignal.timeout(20_000), redirect: "error" },
  );
  if (response.status === 404) {
    void response.body?.cancel().catch(() => {});
    return undefined;
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`npm metadata request failed with HTTP ${response.status}`);
  }
  const value = await response.json();
  if (typeof value?.dist?.integrity !== "string")
    throw new Error("npm metadata has no verifiable dist.integrity");
  return value.dist.integrity;
}

/** Existing versions must be the exact verified bytes, including adopted ones. */
export async function verifyRegistryIntegrity(
  records,
  {
    lookup = registryIntegrity,
    requireAll = false,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    attempts = 7,
  } = {},
) {
  for (const record of records) {
    for (let attempt = 0; ; attempt += 1) {
      const integrity = await lookup(record);
      if (integrity === undefined) {
        if (!requireAll) break;
        if (attempt + 1 >= attempts)
          throw new Error(
            `npm metadata for ${record.name}@${record.version} is still absent after bounded replication retries; retain this run's verified artifacts for recovery`,
          );
        await wait(Math.min(5_000 * 2 ** attempt, 30_000));
        continue;
      }
      if (!integrity.split(/\s+/u).includes(record.integrity))
        throw new Error(
          `npm already has different bytes for ${record.name}@${record.version}; recover the original verified tarball or issue a new version. A rebuilt tarball, even from the same source tree, is not proof of byte identity.`,
        );
      break;
    }
  }
}

/** CAS on a verified descendant: a late branch update cannot publish a tag alone. */
export function pushRelease(root, plan, tag, { remote = "origin" } = {}) {
  assertReleaseTree(root, plan);
  if (plan.publishOnly || !plan.ref.startsWith("refs/heads/"))
    throw new Error("Only a normal branch release may push a new wave");
  if (!tag?.startsWith("release/"))
    throw new Error("Expected a release wave tag");
  checkRef(root, `refs/tags/${tag}`);
  if (
    git(root, ["rev-parse", `refs/tags/${tag}^{commit}`]) !==
    git(root, ["rev-parse", "HEAD"])
  )
    throw new Error("Release tag does not identify the verified commit");
  try {
    git(root, [
      "push",
      "--atomic",
      `--force-with-lease=${plan.ref}:${plan.baseSha}`,
      remote,
      `HEAD:${plan.ref}`,
      `refs/tags/${tag}:refs/tags/${tag}`,
    ]);
  } catch {
    throw new Error(
      "Atomic release push did not confirm success. npm may already contain the wave; inspect the remote branch and tag before retrying. The remote update is all-or-none. Retain this run's plan, patch and verified tarballs and recover that exact tree; do not rerun from an advanced branch.",
    );
  }
}

export function rowsTsv(rows) {
  return rows
    .map(
      (row) =>
        `${row.name}\t${row.version}\t${row.directory}\t${row.tarball}\n`,
    )
    .join("");
}

async function main(argv) {
  const [mode] = argv;
  const option = (name) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const required = (name) => {
    const value = option(name);
    if (!value) throw new Error(`--${name} is required`);
    return value;
  };
  const root = process.cwd();
  if (mode === "export-tarball") {
    exportVerifiedTarball(required("file"), required("directory"));
    return;
  }
  if (mode === "plan") {
    const plan = createReleasePlan(root, {
      baseSha: required("base"),
      ref: required("ref"),
      rows: readReleaseRows(required("tsv")),
      publishOnly: argv.includes("--publish-only"),
    });
    const bytes = `${JSON.stringify(plan, null, 2)}\n`;
    writeFileSync(required("output"), bytes);
    writeFileSync(required("tsv"), rowsTsv(plan.rows));
    process.stdout.write(
      `base_sha=${plan.baseSha}\nrelease_tree=${plan.tree}\nplan_sha=${hash(bytes)}\n`,
    );
    return;
  }
  const digest = required("expected-plan");
  const plan = loadReleasePlan(required("plan"), digest);
  if (mode === "names") {
    process.stdout.write(JSON.stringify(plan.rows.map((row) => row.name)));
    return;
  }
  assertReleaseTree(root, plan);
  if (mode === "verify-tree") return;
  if (mode === "record-artifact") {
    recordArtifact(
      root,
      plan,
      digest,
      required("directory"),
      required("tarballs"),
    );
    return;
  }
  if (mode === "verify-artifacts") {
    verifyArtifacts(root, plan, digest, required("tarballs"));
    writeFileSync(required("tsv"), rowsTsv(plan.rows));
    return;
  }
  if (mode === "preflight") {
    assertRemoteBase(root, plan, {
      afterPublication: argv.includes("--after-publication"),
    });
    return;
  }
  if (mode === "registry") {
    const records = verifyArtifacts(root, plan, digest, required("tarballs"));
    await verifyRegistryIntegrity(records, {
      requireAll: argv.includes("--require-all"),
    });
    return;
  }
  if (mode === "push") {
    pushRelease(root, plan, required("tag"));
    return;
  }
  throw new Error(`Unknown release provenance mode: ${mode}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
