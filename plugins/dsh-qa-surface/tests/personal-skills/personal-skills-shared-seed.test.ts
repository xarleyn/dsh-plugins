import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serviceFor, skillText } from "./personal-skills.helpers.js";

function fixture() {
  const workspace = mkdtempSync(path.join(tmpdir(), "qa-shared-seed-"));
  const root = path.join(workspace, "deployment-skills");
  for (const name of ["proposal", "tables", "release-notes", "search"]) {
    mkdirSync(path.join(root, name, "references"), { recursive: true });
    writeFileSync(
      path.join(root, name, "SKILL.md"),
      skillText(
        [
          `name: ${name}`,
          "description: Deployment instruction.",
          "metadata:",
          "  qa-surface:",
          "    version: 1",
          "    audience:",
          "      type: common",
        ],
        "Original instructions.",
      ),
    );
    writeFileSync(
      path.join(root, name, "references", "guide.md"),
      "Resource bytes.\n",
    );
  }
  const options = {
    workspace,
    sharedSeed: { root, names: ["proposal", "tables", "release-notes"] },
  };
  return { workspace, root, options, ...serviceFor(options) };
}

describe("deployment shared skill promotion", () => {
  it("copies only selected complete skills and keeps metadata and resources after an editor save", () => {
    const { service, root, options } = fixture();
    const scope = { shared: true } as const;
    expect(service.list(scope).map(({ name }) => name)).toEqual([
      "proposal",
      "release-notes",
      "tables",
    ]);
    const doc = service.get(scope, "proposal");
    expect(doc.valid).toBe(true);
    service.update(scope, "proposal", {
      ...doc,
      body: "Edited instructions.",
      expectedRevision: doc.revision,
    });
    const reopened = serviceFor(options).service.get(scope, "proposal");
    expect(reopened.body).toBe("Edited instructions.");
    expect(
      readFileSync(
        path.join(path.dirname(reopened.sourcePath), "references", "guide.md"),
        "utf8",
      ),
    ).toBe("Resource bytes.\n");
    expect(readFileSync(reopened.sourcePath, "utf8")).toContain("qa-surface:");
    expect(
      readFileSync(path.join(root, "proposal", "SKILL.md"), "utf8"),
    ).toContain("Original instructions.");
  });

  it("does not overwrite existing shared files or resurrect a deletion on a new service", () => {
    const { service, options, root } = fixture();
    const scope = { shared: true } as const;
    service.list(scope);
    const doc = service.get(scope, "tables");
    service.remove(scope, "tables", doc.revision);
    writeFileSync(path.join(root, "proposal", "SKILL.md"), "New seed content.");
    expect(
      serviceFor(options)
        .service.list(scope)
        .map(({ name }) => name),
    ).toEqual(["proposal", "release-notes"]);
    expect(service.get(scope, "proposal").body).toBe("Original instructions.");
  });

  it("adopts an existing shared skill without changing it and never reseeds after its removal", () => {
    const { options, workspace } = fixture();
    const shared = path.join(workspace, ".dsh", "skills", "proposal");
    mkdirSync(shared, { recursive: true });
    writeFileSync(
      path.join(shared, "SKILL.md"),
      skillText(["name: proposal", "description: Existing."], "Keep me."),
    );
    const scope = { shared: true } as const;
    const service = serviceFor(options).service;
    const doc = service.get(scope, "proposal");
    expect(doc.body).toBe("Keep me.");
    service.remove(scope, "proposal", doc.revision);
    expect(
      serviceFor(options)
        .service.list(scope)
        .some(({ name }) => name === "proposal"),
    ).toBe(false);
  });

  it("retries after an operator removes a colliding file", () => {
    const { service, workspace } = fixture();
    const shared = path.join(workspace, ".dsh", "skills");
    const target = path.join(shared, "proposal");
    mkdirSync(shared, { recursive: true });
    writeFileSync(target, "Operator file.");

    const scope = { shared: true } as const;
    expect(service.list(scope).map(({ name }) => name)).toEqual([
      "release-notes",
      "tables",
    ]);
    expect(readFileSync(target, "utf8")).toBe("Operator file.");
    expect(existsSync(path.join(shared, ".seeded-proposal"))).toBe(false);
    unlinkSync(target);
    expect(service.get(scope, "proposal").body).toBe("Original instructions.");
  });

  it("retries a missing seed without hiding the remaining catalog", () => {
    const { options, root } = fixture();
    const rig = serviceFor({
      ...options,
      sharedSeed: { root, names: ["missing", "tables"] },
    });
    expect(rig.service.list({ shared: true }).map(({ name }) => name)).toEqual([
      "tables",
    ]);
    mkdirSync(path.join(root, "missing"));
    writeFileSync(
      path.join(root, "missing", "SKILL.md"),
      skillText(["name: missing", "description: Arrived later."]),
    );
    expect(rig.service.list({ shared: true }).map(({ name }) => name)).toEqual([
      "missing",
      "tables",
    ]);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "Operator notes without frontmatter."],
    [
      "oversized",
      skillText(["name: proposal", "description: Large."], "X".repeat(300_000)),
    ],
  ] as const)("adopts a %s operator skill only after repair", (_, initial) => {
    const { workspace, options, service } = fixture();
    const scope = { shared: true } as const;
    const shared = path.join(workspace, ".dsh", "skills");
    const target = path.join(shared, "proposal");
    const manifest = path.join(target, "SKILL.md");
    const receipt = path.join(shared, ".seeded-proposal");
    mkdirSync(target, { recursive: true });
    if (initial !== undefined) writeFileSync(manifest, initial);
    service.list(scope);
    expect(existsSync(receipt)).toBe(false);
    if (initial === undefined) expect(existsSync(manifest)).toBe(false);
    else expect(readFileSync(manifest, "utf8")).toBe(initial);

    writeFileSync(
      manifest,
      skillText(
        ["name: proposal", "description: Repaired."],
        "Operator content.",
      ),
    );
    const restarted = serviceFor(options).service;
    const doc = restarted.get(scope, "proposal");
    expect(doc.body).toBe("Operator content.");
    expect(existsSync(receipt)).toBe(true);
    restarted.update(scope, doc.name, {
      ...doc,
      name: "renamed",
      expectedRevision: doc.revision,
    });
    const afterRename = serviceFor(options).service;
    expect(afterRename.has(scope, "proposal")).toBe(false);
    expect(afterRename.get(scope, "renamed").body).toBe("Operator content.");
  });

  it("retries a linked directory after its removal without adopting or editing its destination", () => {
    const { workspace, options, service } = fixture();
    const scope = { shared: true } as const;
    const shared = path.join(workspace, ".dsh", "skills");
    const other = path.join(shared, "operator");
    const target = path.join(shared, "proposal");
    mkdirSync(other, { recursive: true });
    const original = skillText([
      "name: operator",
      "description: Operator skill.",
    ]);
    writeFileSync(path.join(other, "SKILL.md"), original);
    symlinkSync(other, target, "junction");
    service.list(scope);
    expect(existsSync(path.join(shared, ".seeded-proposal"))).toBe(false);
    expect(readFileSync(path.join(other, "SKILL.md"), "utf8")).toBe(original);
    unlinkSync(target);
    expect(serviceFor(options).service.get(scope, "proposal").body).toBe(
      "Original instructions.",
    );
  });

  it("publishes a broken deployment skill only after its manifest is repaired", () => {
    const { workspace, root, options, service } = fixture();
    const scope = { shared: true } as const;
    const shared = path.join(workspace, ".dsh", "skills");
    const manifest = path.join(root, "proposal", "SKILL.md");
    const original = readFileSync(manifest);
    writeFileSync(manifest, "Invalid deployment instructions.");
    expect(service.list(scope).map(({ name }) => name)).toEqual([
      "release-notes",
      "tables",
    ]);
    expect(existsSync(path.join(shared, "proposal"))).toBe(false);
    expect(existsSync(path.join(shared, ".seeded-proposal"))).toBe(false);
    writeFileSync(manifest, original);
    expect(serviceFor(options).service.get(scope, "proposal").body).toBe(
      "Original instructions.",
    );
    expect(existsSync(path.join(shared, ".seeded-proposal"))).toBe(true);
  });

  it("rejects linked resource trees without publishing a partial skill", () => {
    const { options, root, workspace } = fixture();
    symlinkSync(
      root,
      path.join(root, "proposal", "references", "outside"),
      "junction",
    );
    const service = serviceFor(options).service;
    expect(service.list({ shared: true }).map(({ name }) => name)).toEqual([
      "release-notes",
      "tables",
    ]);
    expect(existsSync(path.join(workspace, ".dsh", "skills", "proposal"))).toBe(
      false,
    );
  });
});
