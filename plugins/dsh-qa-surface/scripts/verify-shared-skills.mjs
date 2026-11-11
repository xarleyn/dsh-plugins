import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Acceptance against built or unpacked modules. A real deployment catalog may
// be supplied read-only; all saves, deletes and restart checks use a scratch
// workspace, never the deployment's shared store. Output contains no skill text.
const packageRoot =
  process.env.QA_SKILL_PACKAGE_ROOT ??
  fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(packageRoot, "package.json"));
const load = (relative) =>
  import(pathToFileURL(path.join(packageRoot, relative)).href);
const { Context } = await import(
  pathToFileURL(require.resolve("@deepseek-ai/cordis")).href
);
const { default: SkillRegistry } = await import(
  pathToFileURL(require.resolve("@deepseek-ai/dsh-skill")).href
);
const { QaPersonalSkills, createQaUserSkillProvider } = await load(
  "lib/personal-skills/index.js",
);
const { resolveConfig } = await load("lib/resolve-config.js");
const { prepareQaUserWorkspace } = await load("lib/user-workspace.js");
const scratch = mkdtempSync(
  path.join(tmpdir(), "qa-shared-skills-acceptance-"),
);
const names = (
  process.env.QA_SKILL_SEED_NAMES ?? "proposal,spreadsheet,release-notes"
).split(",");
const source =
  process.env.QA_SKILL_SEED_SOURCE ?? path.join(scratch, "deployment");
const logger = { info() {}, warn() {}, debug() {}, error() {}, close() {} };
const workspace = path.join(scratch, "workspace");
const scope = { shared: true };
let ctx;
let disposeProvider;

function fingerprint(directory) {
  const files = {};
  function visit(current, relative = "") {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const key = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(path.join(current, entry.name), key);
      else if (entry.isFile())
        files[key] = createHash("sha256")
          .update(readFileSync(path.join(current, entry.name)))
          .digest("hex");
      else throw new Error("acceptance source contains a non-ordinary entry");
    }
  }
  visit(directory);
  return files;
}

try {
  if (process.env.QA_SKILL_SEED_SOURCE === undefined) {
    for (const name of names) {
      mkdirSync(path.join(source, name, "references"), { recursive: true });
      writeFileSync(
        path.join(source, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: Deployment instruction.\nmetadata:\n  qa-surface:\n    version: 1\n    audience:\n      type: common\n---\n\nRead references/guide.md.\n`,
      );
      writeFileSync(
        path.join(source, name, "references", "guide.md"),
        "Resource.\n",
      );
    }
  }
  const before = Object.fromEntries(
    names.map((name) => [name, fingerprint(path.join(source, name))]),
  );
  const config = resolveConfig({
    session: { workspaceId: "workspace-1" },
    accounts: {
      enabled: true,
      perUserWorkspace: true,
      skills: { sharedSeed: { root: source, names }, watch: false },
    },
    lockdown: {
      sandboxMode: "workspace-write",
      permissionPreset: "qa-workspace-write",
      toolPolicy: { allow: ["read"] },
    },
    sources: { enabled: false },
  });
  let invalidate = () => {};
  const service = () =>
    new QaPersonalSkills(
      { tools: { schemas: () => [] } },
      {
        getConfig: () => config,
        workspacePath: () => workspace,
        logger,
        invalidate: () => invalidate(),
      },
    );
  let skills = service();
  assert.deepEqual(
    skills
      .list(scope)
      .map(({ name }) => name)
      .sort(),
    [...names].sort(),
  );
  ctx = new Context();
  await ctx.plugin(SkillRegistry);
  disposeProvider = ctx.skills.registerProvider((control) => {
    invalidate = control.invalidate;
    return createQaUserSkillProvider(control, skills);
  });
  const cwd = prepareQaUserWorkspace(
    workspace,
    "123e4567-e89b-42d3-a456-426614174000",
  );
  for (const name of names) {
    const document = skills.get(scope, name);
    assert.equal(document.valid, true, `seed must parse: ${name}`);
    assert.deepEqual(
      fingerprint(path.dirname(document.sourcePath)),
      before[name],
    );
    const saved = skills.update(
      scope,
      name,
      {
        ...document,
        body: `${document.body}\n\nAcceptance edit.`,
        expectedRevision: document.revision,
      },
      { actorId: "acceptance-admin" },
    );
    assert.notEqual(saved.revision, document.revision);
    assert.equal(saved.adminEdit?.actorId, "acceptance-admin");
    const definition = await ctx.skills.get(name, { cwd });
    assert.equal(definition?.content, saved.body);
    assert.deepEqual(
      definition?.metadata?.["qa-surface"],
      document.extraFrontmatter.metadata?.["qa-surface"],
    );
    assert.deepEqual(definition?.resourceBase, {
      kind: "directory",
      path: path.dirname(saved.sourcePath),
    });
    const after = fingerprint(path.dirname(saved.sourcePath));
    delete after["SKILL.md"];
    const resources = { ...before[name] };
    delete resources["SKILL.md"];
    assert.deepEqual(after, resources);
    assert.throws(
      () =>
        skills.update(scope, name, {
          ...document,
          expectedRevision: document.revision,
        }),
      /changed after it was read/u,
    );
  }
  // Recreate the service just as a process restart does. Seed receipts and
  // saved content must be the authority rather than the read-only originals.
  skills = service();
  for (const name of names)
    assert.ok(skills.get(scope, name).body.endsWith("Acceptance edit."));
  const removed = skills.get(scope, names[0]);
  skills.remove(scope, names[0], removed.revision);
  skills = service();
  assert.equal(skills.list(scope).length, names.length - 1);
  assert.equal(skills.has(scope, names[0]), false);
  for (const name of names)
    assert.deepEqual(fingerprint(path.join(source, name)), before[name]);
  console.log(
    `shared skills acceptance: ${names.length} seeds; editor save, stale-write refusal, metadata, registry load, resource hashes, restart and deletion persistence passed; source unchanged`,
  );
} finally {
  disposeProvider?.();
  assert.ok(
    path.resolve(scratch).startsWith(path.resolve(tmpdir()) + path.sep),
  );
  rmSync(scratch, { recursive: true, force: true });
}
