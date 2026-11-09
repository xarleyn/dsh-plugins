import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertReleaseTree,
  assertRemoteBase,
  createReleasePlan,
  exportVerifiedTarball,
  loadReleasePlan,
  pushRelease,
  registryIntegrity,
  recordArtifact,
  selectTaggedRows,
  verifyArtifacts,
  verifyRegistryIntegrity,
} from "./release-provenance.mjs";

const identity = {
  ...process.env,
  GIT_AUTHOR_NAME: "Synthetic Release",
  GIT_AUTHOR_EMAIL: "release@example.com",
  GIT_COMMITTER_NAME: "Synthetic Release",
  GIT_COMMITTER_EMAIL: "release@example.com",
};
function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    env: identity,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "dsh-release-provenance-"));
  t.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 }),
  );
  const root = path.join(directory, "source");
  const remote = path.join(directory, "remote.git");
  mkdirSync(path.join(root, "packages", "synthetic"), { recursive: true });
  const row = {
    name: "@yadsh/synthetic",
    version: "1.0.1",
    directory: "packages/synthetic",
    tarball: "yadsh-synthetic-1.0.1.tgz",
  };
  const manifest = path.join(root, row.directory, "package.json");
  writeFileSync(manifest, JSON.stringify({ name: row.name, version: "1.0.0" }));
  writeFileSync(path.join(root, "source.js"), "export const source = 1;\n");
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Synthetic Release");
  git(root, "config", "user.email", "release@example.com");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  const baseSha = git(root, "rev-parse", "HEAD");
  git(directory, "init", "--bare", remote);
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "origin", "HEAD:refs/heads/main");
  writeFileSync(
    manifest,
    JSON.stringify({ name: row.name, version: row.version }),
  );
  git(root, "add", ".");
  git(root, "commit", "-m", "release version");
  const plan = createReleasePlan(root, {
    baseSha,
    ref: "refs/heads/main",
    rows: [row],
  });
  const bytes = `${JSON.stringify(plan, null, 2)}\n`;
  const digest = createHash("sha256").update(bytes).digest("hex");
  const planFile = path.join(directory, "release-plan.json");
  writeFileSync(planFile, bytes);
  return { directory, root, remote, row, plan, digest, planFile };
}
function advanceRemote(f) {
  const writer = path.join(f.directory, "writer");
  git(f.directory, "clone", "--branch", "main", f.remote, writer);
  writeFileSync(path.join(writer, "source.js"), "export const source = 2;\n");
  git(writer, "add", ".");
  git(writer, "commit", "-m", "ordinary source change");
  git(writer, "push", "origin", "HEAD:refs/heads/main");
  return { writer, head: git(writer, "rev-parse", "HEAD") };
}
function packed(f) {
  const source = path.join(f.directory, f.row.tarball);
  const tarballs = path.join(f.directory, "tarballs");
  writeFileSync(source, "synthetic verified archive bytes");
  const file = exportVerifiedTarball(source, tarballs);
  const record = recordArtifact(
    f.root,
    f.plan,
    f.digest,
    f.row.directory,
    tarballs,
  );
  return { source, file, tarballs, record };
}

test("a cleanly replayable patch cannot mask a changed source tree", (t) => {
  const f = fixture(t);
  const patch = git(
    f.root,
    "format-patch",
    "--stdout",
    `${f.plan.baseSha}..HEAD`,
  );
  const patchFile = path.join(f.directory, "release.patch");
  writeFileSync(patchFile, `${patch}\n`);
  const { writer } = advanceRemote(f);
  git(writer, "am", patchFile);
  assert.equal(
    JSON.parse(readFileSync(path.join(writer, f.row.directory, "package.json")))
      .version,
    f.row.version,
  );
  assert.throws(
    () => assertReleaseTree(writer, f.plan),
    /source tree differs/u,
  );
  assert.throws(
    () => assertRemoteBase(f.root, f.plan),
    /This attempt stopped before npm publish\. Check earlier attempts and the planned versions on npm/u,
  );
  // The pinned base is still available and yields the prepared source tree.
  const pinned = path.join(f.directory, "pinned");
  git(f.directory, "clone", "--branch", "main", f.remote, pinned);
  git(pinned, "checkout", "--detach", f.plan.baseSha);
  git(pinned, "am", patchFile);
  assert.doesNotThrow(() => assertReleaseTree(pinned, f.plan));
});

test("normal release checks exact artifact bytes and atomically pushes its descendant and tag", async (t) => {
  const f = fixture(t);
  const p = packed(f);
  const records = verifyArtifacts(f.root, f.plan, f.digest, p.tarballs);
  await verifyRegistryIntegrity(records, { lookup: async () => undefined });
  await verifyRegistryIntegrity(records, {
    requireAll: true,
    lookup: async () => p.record.integrity,
  });
  assertRemoteBase(f.root, f.plan);
  git(f.root, "tag", "-a", "release/2026-10-31", "-m", "synthetic wave");
  pushRelease(f.root, f.plan, "release/2026-10-31");
  const head = git(f.root, "rev-parse", "HEAD");
  assert.equal(git(f.remote, "rev-parse", "refs/heads/main"), head);
  assert.equal(
    git(f.remote, "rev-parse", "refs/tags/release/2026-10-31^{commit}"),
    head,
  );
});

test("a branch advance during npm publication cannot push a misleading tag", (t) => {
  const f = fixture(t);
  assertRemoteBase(f.root, f.plan);
  const { head } = advanceRemote(f);
  assert.throws(
    () => assertRemoteBase(f.root, f.plan, { afterPublication: true }),
    /npm may already contain/u,
  );
  git(f.root, "tag", "-a", "release/raced", "-m", "synthetic wave");
  // Models the still narrower race after the post-publication preflight.
  assert.throws(
    () => pushRelease(f.root, f.plan, "release/raced"),
    /Atomic release push/u,
  );
  assert.equal(git(f.remote, "rev-parse", "refs/heads/main"), head);
  assert.equal(git(f.remote, "tag", "--list", "release/raced"), "");
});

test("an identical tree on unrelated history cannot use the push lease", (t) => {
  const f = fixture(t);
  const orphan = git(f.root, "commit-tree", f.plan.tree, "-m", "unrelated");
  git(f.root, "checkout", "--detach", orphan);
  assert.throws(() => assertReleaseTree(f.root, f.plan), /merge-base failed/u);
});

for (const annotated of [false, true]) {
  test(`publish_only accepts an exact ${annotated ? "annotated" : "lightweight"} wave tag`, (t) => {
    const f = fixture(t);
    const tag = "release/2026-10-31";
    git(f.root, "push", "origin", "HEAD:refs/heads/main");
    git(f.root, "tag", ...(annotated ? ["-a", tag, "-m", "wave"] : [tag]));
    git(f.root, "push", "origin", `refs/tags/${tag}`);
    const baseSha = git(f.root, "rev-parse", "HEAD");
    const other = {
      name: "@yadsh/older",
      version: "1.0.0",
      directory: "packages/older",
      tarball: "yadsh-older-1.0.0.tgz",
    };
    const recovery = createReleasePlan(f.root, {
      baseSha,
      ref: `refs/tags/${tag}`,
      rows: [f.row, other],
      publishOnly: true,
    });
    assert.deepEqual(recovery.rows, [f.row]);
    assertReleaseTree(f.root, recovery);
    assertRemoteBase(f.root, recovery);
    assert.throws(
      () =>
        createReleasePlan(f.root, {
          baseSha,
          ref: `refs/tags/${tag}`,
          rows: [f.row],
        }),
      /normal release must be dispatched on a branch/u,
    );
    const branchRecovery = { ...recovery, ref: "refs/heads/main" };
    assertRemoteBase(f.root, branchRecovery);
    assert.throws(
      () => pushRelease(f.root, recovery, tag),
      /Only a normal branch release/u,
    );
  });
}

test("legacy recovery selects tags at this commit, not historical tags elsewhere", (t) => {
  const f = fixture(t);
  const older = {
    name: "@yadsh/older",
    version: "1.0.0",
    directory: "packages/older",
    tarball: "yadsh-older-1.0.0.tgz",
  };
  git(f.root, "tag", `${older.name}@${older.version}`, f.plan.baseSha);
  assert.deepEqual(selectTaggedRows(f.root, [f.row, older]).rows, []);
  git(f.root, "tag", "-a", `${f.row.name}@${f.row.version}`, "-m", "legacy");
  assert.deepEqual(selectTaggedRows(f.root, [f.row, older]).rows, [f.row]);
});

test("plan and artifact tampering fail before publication", (t) => {
  const f = fixture(t);
  assert.deepEqual(loadReleasePlan(f.planFile, f.digest), f.plan);
  writeFileSync(
    f.planFile,
    JSON.stringify({ ...f.plan, ref: "refs/heads/elsewhere" }),
  );
  assert.throws(
    () => loadReleasePlan(f.planFile, f.digest),
    /digest mismatch/u,
  );
  const p = packed(f);
  assert.equal(verifyArtifacts(f.root, f.plan, f.digest, p.tarballs).length, 1);
  writeFileSync(p.file, "tampered archive bytes");
  assert.throws(
    () => verifyArtifacts(f.root, f.plan, f.digest, p.tarballs),
    /provenance mismatch/u,
  );
});

test("artifact export preserves the exact verified file without repacking", (t) => {
  const f = fixture(t);
  const p = packed(f);
  writeFileSync(p.source, "a subsequent pack would be different");
  assert.equal(
    readFileSync(p.file, "utf8"),
    "synthetic verified archive bytes",
  );
  assert.throws(() => exportVerifiedTarball(p.source, p.tarballs), /EEXIST/u);
  const sidecar = path.join(p.tarballs, `${f.row.tarball}.provenance.json`);
  writeFileSync(sidecar, JSON.stringify({ ...p.record, tree: "0".repeat(40) }));
  assert.throws(
    () => verifyArtifacts(f.root, f.plan, f.digest, p.tarballs),
    /tree/u,
  );
});

test("uncommitted source changes and unexpected tarballs invalidate provenance", (t) => {
  const f = fixture(t);
  const p = packed(f);
  writeFileSync(path.join(p.tarballs, "unexpected.tgz"), "extra");
  assert.throws(
    () => verifyArtifacts(f.root, f.plan, f.digest, p.tarballs),
    /selected package set/u,
  );
  writeFileSync(path.join(f.root, "source.js"), "unverified edit");
  assert.throws(() => assertReleaseTree(f.root, f.plan), /git -c failed/u);
});

test("registry guards distinguish absence, lag, refused lookups and conflicting existing bytes", async () => {
  const record = {
    name: "@yadsh/synthetic",
    version: "1.0.1",
    integrity: "sha512-verified",
  };
  await verifyRegistryIntegrity([record], { lookup: async () => undefined });
  await assert.rejects(
    verifyRegistryIntegrity([record], {
      lookup: async () => "sha512-different",
    }),
    /original verified tarball/u,
  );
  await assert.rejects(
    verifyRegistryIntegrity([record], {
      lookup: async () => {
        throw new Error("HTTP 403");
      },
    }),
    /HTTP 403/u,
  );
  let calls = 0;
  const waits = [];
  await verifyRegistryIntegrity([record], {
    requireAll: true,
    lookup: async () => (++calls < 3 ? undefined : record.integrity),
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5000, 10000]);
  await assert.rejects(
    verifyRegistryIntegrity([record], {
      requireAll: true,
      lookup: async () => undefined,
      attempts: 2,
      wait: async () => {},
    }),
    /bounded replication retries/u,
  );
});

test("registry metadata treats only an explicit HTTP 404 as absence", async () => {
  const row = { name: "@yadsh/synthetic", version: "1.0.1" };
  const fetchImpl = async (_url, init) => {
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    return new globalThis.Response(null, { status: 404 });
  };
  assert.equal(await registryIntegrity(row, { fetchImpl }), undefined);
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      registryIntegrity(row, {
        fetchImpl: async () => new globalThis.Response(null, { status }),
      }),
      new RegExp(`HTTP ${status}`, "u"),
    );
  }
  await assert.rejects(
    registryIntegrity(row, {
      fetchImpl: async () => {
        throw new Error("synthetic unavailable transport");
      },
    }),
    /unavailable transport/u,
  );
  await assert.rejects(
    registryIntegrity(row, {
      fetchImpl: async () => globalThis.Response.json({ dist: {} }),
    }),
    /no verifiable dist.integrity/u,
  );
  assert.equal(
    await registryIntegrity(row, {
      fetchImpl: async () =>
        globalThis.Response.json({ dist: { integrity: "sha512-verified" } }),
    }),
    "sha512-verified",
  );
});

test("workflow binds every job to the plan and verifies before publication", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /permissions:\s+contents: read/u);
  assert.doesNotMatch(workflow, /github\.ref_name/u);
  assert.equal(
    (workflow.match(/ref: \$\{\{ github\.sha \}\}/gu) ?? []).length,
    1,
  );
  assert.equal(
    (
      workflow.match(/ref: \$\{\{ needs\.prepare\.outputs\.base_sha \}\}/gu) ??
      []
    ).length,
    3,
  );
  assert.equal(
    (workflow.match(/release-provenance\.mjs verify-tree/gu) ?? []).length,
    3,
  );
  assert.match(
    workflow,
    /matrix: \$\{\{ fromJSON\(needs.prepare.outputs.matrix\) \}\}/u,
  );
  assert.equal((workflow.match(/id-token: write/gu) ?? []).length, 1);
  assert.ok(
    workflow.indexOf("  publish:") < workflow.indexOf("id-token: write"),
  );
  const step = (name) => {
    const index = workflow.indexOf(`- name: ${name}`);
    assert.notEqual(index, -1);
    return index;
  };
  assert.ok(
    step("Verify release artifact provenance") <
      step("Publish to npm with OIDC"),
  );
  assert.ok(
    step("Verify already published artifact integrity") <
      step("Refuse a stale release before publication"),
  );
  assert.ok(
    step("Refuse a stale release before publication") <
      step("Publish to npm with OIDC"),
  );
  assert.ok(
    step("Verify published artifact integrity") < step("Tag the release wave"),
  );
  assert.ok(
    step("Refuse branch or tag drift after publication") <
      step("Tag the release wave"),
  );
  assert.doesNotMatch(workflow, /pack --pack-destination/u);
  assert.match(
    workflow,
    /TARBALL_VERIFY_OUTPUT_DIR: \$\{\{ github.workspace \}\}\/tarballs/u,
  );
  const gate = readFileSync(
    new URL("./tarball-verify.sh", import.meta.url),
    "utf8",
  );
  assert.ok(
    gate.indexOf('gate_install "$rel" "$name" "$tgz"') <
      gate.indexOf("export-tarball \\"),
  );
  assert.match(
    gate,
    /--file="\$tgz" --directory="\$TARBALL_VERIFY_OUTPUT_DIR"/u,
  );
});
