import type { QaHistoryFolderTarget } from "../types/accounts.js";

/** Bound both fields at the server boundary; identifiers are opaque UI keys. */
export function normalizeHistoryFolder(
  input: unknown,
): QaHistoryFolderTarget | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object") throw new TypeError("Invalid virtual folder.");
  const { id, name } = input as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 80 ||
    [...name].some((char) => char.charCodeAt(0) < 32)
  ) {
    throw new TypeError("Invalid virtual folder.");
  }
  return { id, name: name.trim() };
}
