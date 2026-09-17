import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionEraser } from "../src/admin/session-log.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A home with the directory layout a deployment's storage keeps sessions in. */
function fixture(): string {
  const home = mkdtempSync(path.join(tmpdir(), "qa-sessions-"));
  roots.push(home);
  const layout = [
    ["--e-work--", "session-a"],
    ["--e-work--", "session-b"],
    ["--e-work-users-u1--", "child-a"],
  ] as const;
  for (const [project, sessionId] of layout) {
    const directory = path.join(home, "sessions", project, sessionId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "session.jsonl.zstd"), "x");
  }
  return home;
}

describe("stored-session removal", () => {
  it("removes the named sessions wherever their project keeps them", async () => {
    const home = fixture();

    const outcome = await createSessionEraser(home).erase([
      "session-a",
      "child-a",
      "session-gone",
    ]);

    expect(outcome.removed).toEqual(["session-a", "child-a"]);
    // A chat stored under another project is found by id alone: the caller
    // knows the id, never the project key.
    expect(outcome.absent).toEqual(["session-gone"]);
    expect(
      existsSync(path.join(home, "sessions", "--e-work--", "session-a")),
    ).toBe(false);
    expect(existsSync(path.join(home, "sessions", "--e-work-users-u1--"))).toBe(
      true,
    );
    // A session nobody asked about is untouched.
    expect(
      existsSync(path.join(home, "sessions", "--e-work--", "session-b")),
    ).toBe(true);
  });

  it("refuses anything that resolves outside the sessions root", async () => {
    const home = fixture();

    const outcome = await createSessionEraser(home).erase([
      "..",
      "../secrets",
      "session-a/../..",
      "",
      "session-a",
    ]);

    expect(outcome.removed).toEqual(["session-a"]);
    expect(outcome.absent).toEqual(["..", "../secrets", "session-a/../..", ""]);
    expect(existsSync(path.join(home, "sessions"))).toBe(true);
  });

  it("answers an absent home without failing", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "qa-sessions-empty-"));
    roots.push(home);

    expect(await createSessionEraser(home).erase(["session-a"])).toEqual({
      removed: [],
      absent: ["session-a"],
    });
  });
});
