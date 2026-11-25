import {
  link,
  mkdir,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const stagedName = /^cas-[a-f0-9]+-[a-f0-9]{16}\.tmp$/u;

export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Publish one complete file without replacing an earlier writer's file. */
export async function publishFile(
  staged: string,
  destination: string,
): Promise<boolean> {
  try {
    await link(staged, destination);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    if (
      ![
        "EPERM",
        "EACCES",
        "ENOTSUP",
        "EOPNOTSUPP",
        "ENOSYS",
        "EXDEV",
        "EMLINK",
      ].includes(code ?? "")
    )
      throw error;
  }

  // A populated directory cannot replace another populated directory. This
  // elects a complete staged file even on a mount without hard links. Anyone
  // can finish its rename if the original writer has exited.
  const candidate = staged + ".claim";
  const pending = join(dirname(staged), basename(destination) + ".pending");
  const name = basename(staged);
  await mkdir(candidate, { mode: 0o700 });
  try {
    await rename(staged, join(candidate, name));
    try {
      await rename(candidate, pending);
    } catch (error) {
      if (
        !["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      if (!(await exists(pending)) && !(await exists(destination))) throw error;
    }
    let elected: string | undefined;
    try {
      [elected] = await readdir(pending);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (!elected || !stagedName.test(elected)) {
      if (await exists(destination)) return false;
      throw new Error("CAS publication is missing its staged file");
    }
    const selected = join(pending, elected);
    // A late contender can claim an emptied directory after another
    // publication. Its unique filename keeps cleanup out of newer claims.
    if (await exists(destination)) {
      await unlink(selected).catch(() => undefined);
      return false;
    }
    try {
      await rename(selected, destination);
      return true;
    } catch (error) {
      if (isMissing(error) && (await exists(destination))) return false;
      throw error;
    }
  } finally {
    await unlink(join(candidate, name)).catch(() => undefined);
    await rmdir(candidate).catch(() => undefined);
    await rmdir(pending).catch(() => undefined);
  }
}

/** The ordinary orphan sweep also retires abandoned no-hard-link staging. */
export async function removeStalePublication(path: string): Promise<boolean> {
  const name = basename(path);
  const candidate =
    name.endsWith(".claim") && stagedName.test(name.slice(0, -".claim".length));
  if (!candidate && !/^[a-f0-9]{64}\.(?:blob|json)\.pending$/u.test(name))
    return false;
  const children = await readdir(path, { withFileTypes: true });
  if (children.some((child) => !child.isFile() || !stagedName.test(child.name)))
    return false;
  for (const child of children) await unlink(join(path, child.name));
  await rmdir(path);
  return true;
}
