import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { QaAccounts } from "../accounts/store.js";
import {
  locateSessionDirectories,
  type QaSessionEraseOutcome,
} from "./session-log.js";

export interface QaSessionPurge {
  stage(
    accounts: QaAccounts,
    userId: string,
    targets: readonly string[],
    required: ReadonlySet<string>,
  ): QaSessionEraseOutcome;
  recover(accounts: QaAccounts, userId?: string): void;
}

/** Directory moves are reversible until the account transaction commits. Each
 * batch stays outside the Harness sessions tree, on the same filesystem. */
export function createSessionPurge(
  dropSources: (id: string) => void,
  onDeferredCleanup: (error: unknown) => void,
  home?: string,
): QaSessionPurge {
  const base = () =>
    path.resolve(home ?? (process.env.DSH_HOME?.trim() || process.cwd()));
  const journal = (accounts: QaAccounts) =>
    path.join(
      base(),
      ".qa-session-purges",
      createHash("sha256")
        .update(path.resolve(accounts.filePath))
        .digest("hex"),
    );
  const key = (id: string) => Buffer.from(id).toString("hex");
  const dirs = (where: string) =>
    readdirSync(where, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  const restore = (folder: string) => {
    const staged = path.join(folder, "sessions");
    if (!existsSync(staged)) return;
    for (const project of dirs(staged)) {
      const from = path.join(staged, project);
      const destination = path.join(base(), "sessions", project);
      mkdirSync(destination, { recursive: true });
      for (const file of readdirSync(from)) {
        const to = path.join(destination, file);
        if (existsSync(to))
          throw new Error(
            "Cannot restore a staged session over an existing history.",
          );
        renameSync(path.join(from, file), to);
      }
    }
  };
  const forgetSources = (folder: string) => {
    const manifest = path.join(folder, "targets.json");
    if (!existsSync(manifest)) return;
    const targets: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    if (
      !Array.isArray(targets) ||
      !targets.every((id) => typeof id === "string")
    )
      throw new Error("Invalid session purge manifest.");
    for (const target of targets) dropSources(target);
  };
  return {
    stage(accounts, userId, targets, required) {
      const { directories, absent } = locateSessionDirectories(
        targets,
        required,
        base(),
      );
      const folder = path.join(journal(accounts), key(userId));
      mkdirSync(journal(accounts), { recursive: true, mode: 0o700 });
      mkdirSync(folder, { mode: 0o700 });
      writeFileSync(
        path.join(folder, "targets.json"),
        JSON.stringify(targets),
        { flag: "wx", mode: 0o600 },
      );
      for (const [id, source] of directories) {
        const project = path.join(
          folder,
          "sessions",
          path.basename(path.dirname(source)),
        );
        mkdirSync(project, { recursive: true });
        renameSync(source, path.join(project, id));
      }
      return { removed: [...directories.keys()], absent };
    },
    recover(accounts, userId) {
      const root = journal(accounts);
      if (!existsSync(root)) return;
      accounts.reconcileRemoval((exists) => {
        for (const name of userId === undefined ? dirs(root) : [key(userId)]) {
          const id = Buffer.from(name, "hex").toString();
          const folder = path.join(root, name);
          if (!id || key(id) !== name || !existsSync(folder)) continue;
          const shouldRestore = exists(id);
          try {
            if (shouldRestore) restore(folder);
            else forgetSources(folder);
            rmSync(folder, { recursive: true, force: true });
          } catch (error) {
            onDeferredCleanup(error);
            // This user's next removal must wait for its pending restoration.
            if (shouldRestore && userId !== undefined) throw error;
          }
        }
      });
    },
  };
}
