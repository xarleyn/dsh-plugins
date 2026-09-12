import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  QA_USER_WORKSPACE_MAX_WRITE_BYTES,
  QA_USER_WORKSPACE_MAX_BYTES,
  QA_USER_WORKSPACES_DIRECTORY,
  existingQaUserWorkspace,
  pathIsInside,
  prepareQaUserWorkspace,
  qaUserWorkspaceDenial,
} from "../src/user-workspace.js";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("per-user QA workspace", () => {
  it("creates one unregistered child rooted below the configured workspace", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-workspace-"));
    const root = prepareQaUserWorkspace(workspace, USER_ID);
    expect(root).toBe(
      path.join(workspace, QA_USER_WORKSPACES_DIRECTORY, USER_ID),
    );
    expect(existingQaUserWorkspace(workspace, USER_ID)).toBe(root);
    expect(pathIsInside(root, workspace)).toBe(true);
    expect(() => prepareQaUserWorkspace(workspace, "../../escape")).toThrow(
      /account id/u,
    );
  });

  it("rejects a user-directory symlink even when it points inside the base", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-workspace-link-"));
    const users = path.join(workspace, QA_USER_WORKSPACES_DIRECTORY);
    const target = path.join(users, "target");
    mkdirSync(target, { recursive: true });
    symlinkSync(
      target,
      path.join(users, USER_ID),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => prepareQaUserWorkspace(workspace, USER_ID)).toThrow(
      /real directory/u,
    );
  });

  it("contains file tools, follows symlink identity, and blocks process/git escape hatches", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-workspace-guard-"));
    const outside = mkdtempSync(path.join(tmpdir(), "qa-outside-"));
    const root = prepareQaUserWorkspace(workspace, USER_ID);
    writeFileSync(path.join(root, "inside.txt"), "ok");
    symlinkSync(
      outside,
      path.join(root, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(
      qaUserWorkspaceDenial(
        { name: "read", arguments: { file_path: "inside.txt" } },
        root,
      ),
    ).toBeUndefined();
    for (const filePath of [
      "../other-user/secret",
      path.join(root, "escape", "secret"),
    ]) {
      expect(
        qaUserWorkspaceDenial(
          { name: "read", arguments: { file_path: filePath } },
          root,
        ),
      ).toMatch(/outside/u);
    }
    for (const name of [
      "bash",
      "terminal_write",
      "job_create",
      "run_code",
      "lsp",
      "dsh_git_history",
    ]) {
      expect(qaUserWorkspaceDenial({ name, arguments: {} }, root)).toMatch(
        /outside/u,
      );
    }
    expect(
      qaUserWorkspaceDenial(
        {
          name: "write",
          arguments: {
            file_path: "inside.txt",
            content: "x",
            sandbox_permissions: "danger-full-access",
          },
        },
        root,
      ),
    ).toMatch(/outside/u);
    expect(
      qaUserWorkspaceDenial(
        {
          name: "edit",
          arguments: {
            file_path: "inside.txt",
            old_string: "o",
            new_string: "expanded",
            replace_all: true,
          },
        },
        root,
      ),
    ).toMatch(/outside/u);
  });

  it("caps one model-controlled write", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-workspace-quota-"));
    const root = prepareQaUserWorkspace(workspace, USER_ID);
    expect(
      qaUserWorkspaceDenial(
        {
          name: "write",
          arguments: {
            file_path: "large.txt",
            content: "x".repeat(QA_USER_WORKSPACE_MAX_WRITE_BYTES + 1),
          },
        },
        root,
      ),
    ).toMatch(/quota/u);

    const full = path.join(root, "full.bin");
    writeFileSync(full, "");
    truncateSync(full, QA_USER_WORKSPACE_MAX_BYTES);
    expect(
      qaUserWorkspaceDenial(
        {
          name: "write",
          arguments: { file_path: "next.txt", content: "x" },
        },
        root,
      ),
    ).toMatch(/quota/u);
  });
});
