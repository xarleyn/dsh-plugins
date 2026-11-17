import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const TEST_TEMP_CONTEXT = "dshTestTempRoot";

declare module "vitest" {
  interface ProvidedContext {
    dshTestTempRoot: string;
  }
}

/** Remove links themselves before recursively removing an owned test tree. */
function unlinkTree(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        // Windows directory junctions need rmdir; POSIX links need unlink.
        rmdirSync(target);
      } catch (error) {
        if (
          !["ENOTDIR", "EINVAL", "ENOENT"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        unlinkSync(target);
      }
    } else if (entry.isDirectory()) {
      unlinkTree(target);
    }
  }
}

/** Each Vitest invocation owns exactly this new directory, never its parent. */
export function createTestTempRoot(parent = tmpdir()) {
  const base = path.resolve(parent);
  const directory = mkdtempSync(path.join(base, `dsh-tests-${process.pid}-`));
  writeFileSync(
    path.join(directory, ".test-owner.json"),
    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
  );
  return {
    directory,
    remove(): void {
      if (
        path.dirname(directory) !== base ||
        !path.basename(directory).startsWith("dsh-tests-")
      ) {
        throw new Error(
          "Refusing to remove a directory outside this test run.",
        );
      }
      let stat;
      try {
        stat = lstatSync(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (stat.isSymbolicLink()) {
        rmdirSync(directory);
        return;
      }
      unlinkTree(directory);
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}
