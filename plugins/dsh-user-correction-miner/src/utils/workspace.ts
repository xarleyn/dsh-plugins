import { resolve } from "node:path";
import { platform } from "node:os";
import { sha256 } from "./hashing.js";

export function normalizeWorkspacePath(cwd: string): string {
  const normalized = resolve(cwd).replaceAll("\\", "/").replace(/\/$/u, "");
  return platform() === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function workspaceKey(cwd: string): string {
  return sha256(normalizeWorkspacePath(cwd));
}

export function sameWorkspace(left: string | undefined, right: string): boolean {
  return left !== undefined && normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}
