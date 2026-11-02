import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaAttachmentAccess } from "../../src/attachment-access.js";
import { qaUserWorkspaceDenial } from "../../src/user-workspace.js";

const message = (ref: string) => ({
  type: "user/message",
  data: {
    content: [{ type: "file", attachment: ref }],
  },
});
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "qa-exact-attachments-"));
  directories.push(base);
  const root = path.join(base, "store"),
    work = path.join(base, "work");
  mkdirSync(root);
  mkdirSync(work);
  const files = new Map(
    ["own", "foreign", "new"].map((name) => {
      const file = path.join(root, `${name}.txt`);
      writeFileSync(file, name);
      return [name, file];
    }),
  );
  const grants = new Map<string, readonly string[]>();
  const documents = {
    registerInputRoots: (id: string, paths: readonly string[]) => {
      grants.set(id, paths);
      return () => {
        grants.delete(id);
      };
    },
  };
  let currentDocuments = documents;
  const ctx = {
    get: (name: string) =>
      name === "attachments"
        ? {
            root,
            fileHostPath: (ref: string) => {
              const file = files.get(ref);
              if (file === undefined) throw new Error("Unknown reference");
              return file;
            },
          }
        : name === "documents"
          ? currentDocuments
          : undefined,
  };
  return {
    root,
    work,
    files,
    grants,
    ctx,
    replaceDocuments: (next: typeof documents) => {
      currentDocuments = next;
    },
  };
}

describe("exact conversation attachment capabilities", () => {
  it("preserves accepted own files, excludes other accounts and raw paths, and inherits only the admitted scope", async () => {
    const f = fixture();
    const access = new QaAttachmentAccess(f.ctx as never);
    await access.admit({
      id: "a",
      snapshotEvents: () => [message("own"), message("unknown")],
    });
    await access.admit({ id: "b", snapshotEvents: () => [message("foreign")] });
    access.observe("a", [
      { type: "assistant/message", data: message("foreign").data },
      { type: "tool/result", data: message("foreign").data },
      {
        type: "user/message",
        data: { content: [{ type: "text", text: f.files.get("foreign") }] },
      },
    ]);
    access.inherit({ id: "child" }, "a");
    expect(access.files("child")).toEqual([f.files.get("own")]);
    expect(f.grants.get("a")).toEqual([f.files.get("own")]);
    expect(f.grants.get("child")).toEqual([f.files.get("own")]);
    for (const target of [
      f.root,
      f.files.get("foreign")!,
      `${f.files.get("own")!}.sibling`,
    ]) {
      expect(
        qaUserWorkspaceDenial(
          {
            name: "str_replace_editor",
            arguments: { command: "view", path: target },
          },
          f.work,
          f.root,
          {
            attachmentFiles: access.files("a"),
          },
        ),
      ).toMatch(/outside/u);
    }
    access.observe("a", [message("new")]);
    expect(f.grants.get("child")).toEqual([
      f.files.get("own"),
      f.files.get("new"),
    ]);
    expect(
      qaUserWorkspaceDenial(
        { name: "read", arguments: { file_path: f.files.get("new") } },
        f.work,
        f.root,
        {
          attachmentFiles: access.files("a"),
        },
      ),
    ).toBeUndefined();
    access.revoke("child");
    expect(f.grants.has("child")).toBe(false);
    expect(access.files("a")).toHaveLength(2);
    access.dispose();
    expect(f.grants.size).toBe(0);
  });

  it("restores the persisted prefix and includes a prompt accepted during hydration before its first read", async () => {
    const f = fixture();
    let finish!: (events: readonly unknown[]) => void;
    const history = new Promise<readonly unknown[]>((resolve) => {
      finish = resolve;
    });
    const access = new QaAttachmentAccess(f.ctx as never, {
      readEvents: () => history,
    });
    const live: unknown[] = [];
    const ready = access.admit({ id: "a", snapshotEvents: () => live });
    live.push(message("new"));
    access.observe("a", live);
    finish([message("own")]);
    await ready;
    expect(new Set(access.files("a"))).toEqual(
      new Set([f.files.get("own"), f.files.get("new")]),
    );
    expect(f.grants.get("a")).not.toContain(f.root);
  });

  it("does not revive grants after disposal during a persisted read", async () => {
    const f = fixture();
    let finish!: (events: readonly unknown[]) => void;
    const restoreFiles = vi.fn();
    const access = new QaAttachmentAccess(f.ctx as never, {
      readEvents: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      restoreFiles,
    });
    const ready = access.admit({ id: "a" });
    access.dispose();
    finish([message("own")]);
    await ready;
    expect(access.files("a")).toEqual([]);
    expect(f.grants.size).toBe(0);
    expect(restoreFiles).not.toHaveBeenCalled();
  });

  it("reinstalls the same exact files after the Documents service remounts", async () => {
    const f = fixture();
    const access = new QaAttachmentAccess(f.ctx as never);
    await access.admit({ id: "a", snapshotEvents: () => [message("own")] });
    const registerInputRoots = vi.fn(() => () => {});
    f.replaceDocuments({ registerInputRoots });
    access.observe("a", []);
    expect(registerInputRoots).toHaveBeenCalledExactlyOnceWith("a", [
      f.files.get("own"),
    ]);
    expect(f.grants.size).toBe(0);
    await access.admit({ id: "a" });
    expect(registerInputRoots).toHaveBeenCalledOnce();
    access.dispose();
  });

  it("revokes a failed hydration and allows a later verified retry", async () => {
    const f = fixture();
    const readEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce([message("own")]);
    const access = new QaAttachmentAccess(f.ctx as never, { readEvents });
    await expect(access.admit({ id: "a" })).rejects.toThrow("unavailable");
    expect(access.files("a")).toEqual([]);
    await access.admit({ id: "a" });
    expect(access.files("a")).toEqual([f.files.get("own")]);
    access.dispose();
  });
});
