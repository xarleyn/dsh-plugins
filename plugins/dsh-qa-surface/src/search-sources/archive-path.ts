import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { segments } from "./protocol.js";
import type { EntryKind, InventoryPolicy } from "./inventory-policy.js";

export const directoryFlags =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
export function permittedPath(
  parts: string[],
  kind: EntryKind,
  policy?: InventoryPolicy,
) {
  return parts.every(
    (name, i) =>
      !policy ||
      policy.permits(name, i === parts.length - 1 ? kind : "directory"),
  );
}
export async function openArchivePath(
  root: string,
  directory: string,
  path: string,
  kind: EntryKind,
  signal: AbortSignal,
  policy?: InventoryPolicy,
) {
  const parts = segments(path);
  if (segments(directory).length !== 1 || !permittedPath(parts, kind, policy))
    throw new Error("Path unavailable.");
  let handle = await open(root, directoryFlags);
  try {
    const steps = [directory, ...parts];
    for (const [i, name] of steps.entries()) {
      signal.throwIfAborted();
      const next = await open(
        "/proc/self/fd/" + handle.fd + "/" + name,
        kind === "directory" || i !== steps.length - 1
          ? directoryFlags
          : fileFlags,
      );
      await handle.close();
      handle = next;
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
