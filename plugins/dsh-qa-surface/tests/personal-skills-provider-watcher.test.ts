import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QaSkillWatcher } from "../src/personal-skills/index.js";

describe("manual-edit watcher", () => {
  it("follows a root once, coalesces events and bounds its registrations", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-skills-watch-"));
    const other = mkdtempSync(path.join(tmpdir(), "qa-skills-watch-b-"));
    const third = mkdtempSync(path.join(tmpdir(), "qa-skills-watch-c-"));
    let changes = 0;
    const watcher = new QaSkillWatcher({
      onChange: () => {
        changes += 1;
      },
      onError: () => undefined,
      debounceMs: 20,
      limit: 2,
    });
    watcher.follow(root);
    watcher.follow(root);
    expect(watcher.size).toBe(1);
    watcher.follow(other);
    watcher.follow(third);
    // The bound evicts the least recently added root rather than growing.
    expect(watcher.size).toBe(2);

    writeFileSync(
      path.join(other, "SKILL.md"),
      `---
name: watched
description: Watched.
---
`,
    );
    const deadline = Date.now() + 5_000;
    while (changes === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(changes).toBeGreaterThan(0);

    watcher.dispose();
    expect(watcher.size).toBe(0);
  });
});
