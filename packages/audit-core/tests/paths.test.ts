import { describe, expect, it } from "vitest";
import {
  auditDirectoryName,
  auditDirectoryPath,
  isPathContained,
  isSafeDirectoryName,
} from "../src/paths.js";

describe("isPathContained", () => {
  const root = "/data/dsh-audits";

  it("accepts the root itself and its children", () => {
    expect(isPathContained(root, root)).toBe(true);
    expect(isPathContained(root, `${root}/session-1/analysis.json`)).toBe(true);
  });

  it("rejects a sibling, a parent, and a traversal", () => {
    expect(isPathContained(root, "/data/other")).toBe(false);
    expect(isPathContained(root, "/data/dsh-audits-2/x")).toBe(false);
    expect(isPathContained(root, "/data")).toBe(false);
    expect(isPathContained(root, `${root}/../secrets`)).toBe(false);
  });

  it("rejects an absolute path smuggled in as a child", () => {
    expect(isPathContained(root, "/etc/passwd")).toBe(false);
  });
});

describe("isSafeDirectoryName", () => {
  it("accepts the naming convention", () => {
    expect(isSafeDirectoryName("session-41b4e63f")).toBe(true);
    expect(isSafeDirectoryName("session-1")).toBe(true);
    expect(isSafeDirectoryName("audit-f3e452")).toBe(true);
  });

  it("rejects traversal, separators, empties and device-style names", () => {
    for (const name of [
      "..",
      ".",
      "",
      "../escape",
      "a/b",
      "a\\b",
      "C:\\Windows",
      "c:relative",
      " padded",
      "trailing ",
      "nul\0byte",
    ]) {
      expect(isSafeDirectoryName(name), name).toBe(false);
    }
  });
});

describe("auditDirectoryName", () => {
  it("shortens a uuid session id to its first segment", () => {
    expect(
      auditDirectoryName("session-41b4e63f-9e35-4406-927b-25a60b7be2c2"),
    ).toBe("session-41b4e63f");
  });

  it("keeps a short id intact", () => {
    expect(auditDirectoryName("session-1")).toBe("session-1");
    expect(auditDirectoryName("session-0ad608a8")).toBe("session-0ad608a8");
  });

  it("falls back to the id when it does not follow the convention", () => {
    expect(auditDirectoryName("demo-session")).toBe("demo-session");
    expect(auditDirectoryName("session-")).toBe("session-");
  });
});

describe("auditDirectoryPath", () => {
  it("joins a safe name onto the root", () => {
    expect(auditDirectoryPath("/data/audits", "session-1")).toMatch(
      /[/\\]data[/\\]audits[/\\]session-1$/u,
    );
  });

  it("refuses a name that would escape the root", () => {
    expect(() => auditDirectoryPath("/data/audits", "../escape")).toThrow(
      /unsafe audit directory name/u,
    );
    expect(() => auditDirectoryPath("/data/audits", "/etc")).toThrow(
      /unsafe audit directory name/u,
    );
  });
});
