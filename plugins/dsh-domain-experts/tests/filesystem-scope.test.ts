import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resolveAllWithinRoot,
  resolveWithinRoot,
} from "../src/host/scopes/filesystem.js";

/**
 * Real-path containment (design §41: symlink and path escapes).
 *
 * The lexical guard is covered in path-guard.test.ts; this file exercises the
 * filesystem-backed half, where an intermediate directory can be a symlink that
 * points outside the allowed root and defeats a purely textual check.
 */

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-domain-experts-scope-"));
  await mkdir(join(root, "services", "payments"), { recursive: true });
  await writeFile(
    join(root, "services", "payments", "handler.ts"),
    "export {};\n",
  );
});

afterAll(async () => {
  if (root === "") return;
  await rm(root, { recursive: true, force: true });
});

describe("resolveWithinRoot", () => {
  it("resolves an existing file inside the root", () => {
    const resolved = resolveWithinRoot(root, "services/payments/handler.ts");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.path.endsWith("handler.ts")).toBe(true);
    }
  });

  it("resolves a path that does not exist yet inside the root", () => {
    const resolved = resolveWithinRoot(root, "services/payments/new/thing.ts");
    expect(resolved.ok).toBe(true);
  });

  it("refuses traversal, absolute paths and empty input without touching the disk", () => {
    expect(resolveWithinRoot(root, "../outside.ts")).toMatchObject({
      ok: false,
      reason: "escape",
    });
    expect(resolveWithinRoot(root, "/etc/passwd")).toMatchObject({
      ok: false,
      reason: "absolute",
    });
    expect(resolveWithinRoot(root, "   ")).toMatchObject({
      ok: false,
      reason: "empty",
    });
    expect(resolveWithinRoot("", "services/payments")).toMatchObject({
      ok: false,
      reason: "no-root",
    });
  });

  it("refuses a symlinked directory that escapes the root", async () => {
    const outside = await mkdtemp(
      join(tmpdir(), "dsh-domain-experts-outside-"),
    );
    try {
      await writeFile(join(outside, "secret.txt"), "not yours\n");
      const link = join(root, "escape-link");
      try {
        await symlink(outside, link, "dir");
      } catch {
        // Creating a symlink needs a privilege this platform may not grant;
        // the lexical guard still covers the deterministic cases above.
        return;
      }
      const throughLink = resolveWithinRoot(root, "escape-link/secret.txt");
      expect(throughLink.ok).toBe(false);
      if (!throughLink.ok) {
        expect(throughLink.reason).toBe("symlink-escape");
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("resolves every pattern of a scope and keeps the failures visible", () => {
    const resolved = resolveAllWithinRoot(root, [
      "services/payments/**",
      "../escape",
      "/absolute",
    ]);
    expect(resolved.map((entry) => entry.ok)).toEqual([true, false, false]);
  });
});
