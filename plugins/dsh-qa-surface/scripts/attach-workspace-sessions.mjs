#!/usr/bin/env node

/**
 * Attach existing DSH sessions to a registered Workspace.
 *
 * DSH grants Workspace membership exactly once, and only at creation: the
 * `workspaceId` branch of `session.create` calls `Workspace.attachSession`,
 * which refuses a session whose canonical cwd is not exactly the Workspace
 * path (packages/workspace/workspace/src/entity.ts), and the browser builds
 * the workspace tree from `workspace.sessionIds` alone
 * (packages/client/ui-workspace/src/client/tree.ts). A session created through
 * the `cwd` pin - or through the `workspaceId` pin with the same directory
 * spelled differently - therefore never joins a workspace and stays in the
 * host UI's "Ungrouped" bucket forever: the contract has no attach RPC,
 * `insertSessionBefore` only reorders existing members, and dragging a session
 * never leaves its group.
 *
 * This command repairs that state offline, on the registry file the host
 * writes itself (`$DSH_HOME/storages/workspace.json`). It adopts every session
 * whose canonical cwd equals a registered Workspace path, and only those.
 * Sessions below a Workspace path - a QA per-user `.qa-users/<uuid>` root, for
 * instance - are reported and refused: the host filters membership by that
 * same comparison on every read, so it would drop them again on the next
 * start.
 */

import {
  chmodSync,
  closeSync,
  copyFileSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";

/** Storage file holding every Workspace record and its membership. */
export const REGISTRY_FILE = path.join("storages", "workspace.json");

/** Session logs live in `<home>/sessions/<escaped cwd>/<session id>/`. */
export const SESSIONS_DIRECTORY = "sessions";

const HEADER_BYTES = 64 * 1024;

function isDirectory(target) {
  try {
    return lstatSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Canonical path of an existing directory, for the byte-exact comparison the
 * host performs. A path that does not resolve has no membership anywhere.
 * @param target - absolute directory path.
 * @returns canonical path, or undefined when it cannot be resolved.
 */
export function canonical(target) {
  if (typeof target !== "string" || target === "") return undefined;
  try {
    const resolved = realpathSync.native(target);
    return isDirectory(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/** Windows paths differ in case between spellings of one directory. */
function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** A path strictly below another one, for the refusal report. */
function isBelow(target, root) {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

/** The session log inside one session directory, if it carries one. */
function sessionLog(directory) {
  for (const entry of readdirSync(directory)) {
    if (entry.endsWith(".jsonl.zstd") || entry.endsWith(".jsonl")) {
      return path.join(directory, entry);
    }
  }
  return undefined;
}

function firstBytes(file) {
  const handle = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    return buffer.subarray(0, readSync(handle, buffer, 0, HEADER_BYTES, 0));
  } finally {
    closeSync(handle);
  }
}

/**
 * Read the header line of one session log. The header is the first JSON line
 * of the first Zstandard frame; a plaintext log keeps the same line first.
 * @param file - session log path.
 * @returns parsed header, or undefined when the file carries none.
 */
export function readSessionHeader(file) {
  let text;
  try {
    text =
      file.endsWith(".zstd") === true
        ? zstdDecompressSync(readFileSync(file)).toString("utf8")
        : firstBytes(file).toString("utf8");
  } catch {
    return undefined;
  }
  const end = text.indexOf("\n");
  const line = end === -1 ? text : text.slice(0, end);
  try {
    const header = JSON.parse(line);
    return header?.type === "session" ? header : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every session the store knows, with the facts membership depends on.
 * @param home - DSH home directory.
 * @returns session records in directory order.
 */
export function collectSessions(home) {
  const root = path.join(home, SESSIONS_DIRECTORY);
  const sessions = [];
  if (!isDirectory(root)) return sessions;
  for (const projectDir of readdirSync(root)) {
    const projectPath = path.join(root, projectDir);
    if (!isDirectory(projectPath)) continue;
    for (const sessionDir of readdirSync(projectPath)) {
      const sessionPath = path.join(projectPath, sessionDir);
      if (!isDirectory(sessionPath)) continue;
      const log = sessionLog(sessionPath);
      if (log === undefined) continue;
      const header = readSessionHeader(log);
      if (header === undefined || typeof header.id !== "string") continue;
      sessions.push({
        id: header.id,
        cwd: typeof header.cwd === "string" ? header.cwd : undefined,
        subagent: header.parentSession !== undefined,
        createdAt: typeof header.createdAt === "number" ? header.createdAt : 0,
      });
    }
  }
  return sessions;
}

/**
 * Read the Workspace registry.
 * @param file - registry path.
 * @returns parsed registry.
 */
export function readRegistry(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `cannot read the workspace registry ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (parsed?.tables?.workspaces === undefined) {
    throw new Error(`${file}: no workspace table; not a DSH registry`);
  }
  return parsed;
}

/**
 * Decide what an offline repair would change, without touching anything.
 * @param options - home directory, optional single workspace, subagent switch.
 * @returns one entry per workspace plus the sessions no repair can place.
 */
export function planAttachments({ home, workspace, includeSubagents = false }) {
  const registryPath = path.join(home, REGISTRY_FILE);
  const registry = readRegistry(registryPath);
  const archived = new Set(registry.global?.archivedSessionIds ?? []);
  const sessions = collectSessions(home);
  const claimed = new Set(
    Object.values(registry.tables.workspaces).flatMap(
      (record) => record.sessionIds,
    ),
  );
  const requested =
    workspace === undefined ? undefined : workspace.trim().toLowerCase();

  const workspaces = [];
  for (const [id, record] of Object.entries(registry.tables.workspaces)) {
    if (
      requested !== undefined &&
      requested !== id.toLowerCase() &&
      requested !== String(record.path).toLowerCase()
    ) {
      continue;
    }
    const root = canonical(record.path);
    const entry = {
      id,
      path: record.path,
      title: record.title,
      root,
      attachable: [],
      below: [],
      unresolved: [],
      archived: 0,
      elsewhere: 0,
      refused: 0,
      members: record.sessionIds.length,
    };
    workspaces.push(entry);
    if (root === undefined) continue;
    for (const session of sessions) {
      if (record.sessionIds.includes(session.id)) continue;
      if (archived.has(session.id)) {
        entry.archived += 1;
        continue;
      }
      if (!includeSubagents && session.subagent) {
        entry.refused += 1;
        continue;
      }
      const cwd = canonical(session.cwd);
      if (cwd === undefined) {
        entry.unresolved.push(session);
        continue;
      }
      if (samePath(cwd, root)) {
        entry.attachable.push({ ...session, cwd });
        continue;
      }
      if (isBelow(cwd, root)) {
        entry.below.push({ ...session, cwd });
        continue;
      }
      entry.elsewhere += 1;
    }
    entry.attachable.sort((left, right) => right.createdAt - left.createdAt);
  }

  return {
    registryPath,
    workspaces,
    sessions: sessions.length,
    claimed: claimed.size,
  };
}

/**
 * Publish one plan. Only the membership list and `updatedAt` change, exactly
 * as `Workspace.attachSession` writes them; every other field of the registry
 * is preserved.
 * @param plan - result of {@link planAttachments}.
 * @param options - `write` false keeps the registry untouched.
 * @returns what was (or would be) written.
 */
export function applyPlan(plan, { write = false } = {}) {
  const before = statSync(plan.registryPath);
  const registry = readRegistry(plan.registryPath);
  const adopted = [];
  for (const entry of plan.workspaces) {
    if (entry.attachable.length === 0) continue;
    const record = registry.tables.workspaces[entry.id];
    if (record === undefined) continue;
    // Newest first, the order `attachSession` prepends into.
    const ids = entry.attachable.map((session) => session.id);
    adopted.push({ id: entry.id, path: record.path, ids });
    record.sessionIds = [
      ...ids,
      ...record.sessionIds.filter((id) => !ids.includes(id)),
    ];
    record.updatedAt = new Date().toISOString();
  }
  if (adopted.length === 0 || !write) {
    return { adopted, written: false, backup: undefined };
  }

  const now = statSync(plan.registryPath);
  if (now.size !== before.size || now.mtimeMs !== before.mtimeMs) {
    throw new Error(
      `${plan.registryPath}: changed while being inspected; stop DSH and retry`,
    );
  }
  const backup = `${plan.registryPath}.pre-workspace-attach.bak`;
  copyFileSync(plan.registryPath, backup, fsConstants.COPYFILE_EXCL);
  const temp = `${plan.registryPath}.${process.pid}.attach.tmp`;
  writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, {
    mode: before.mode,
  });
  chmodSync(temp, before.mode);
  renameSync(temp, plan.registryPath);
  // Re-read before reporting success: a registry the host cannot parse would
  // lose the operator's whole workspace list, not just this repair.
  const written = readRegistry(plan.registryPath);
  for (const entry of adopted) {
    const record = written.tables.workspaces[entry.id];
    if (
      record === undefined ||
      !entry.ids.every((id) => record.sessionIds.includes(id))
    ) {
      throw new Error(`${plan.registryPath}: ${entry.id} lost the adopted ids`);
    }
  }
  return { adopted, written: true, backup };
}

function usage() {
  return `Usage: qa-attach-sessions [--write] [--home <dir>] [--workspace <uuid-or-path>] [--include-subagents]

Dry-run is the default. Adopts every session whose stored cwd IS a registered
Workspace path (matched after realpath), which is the only membership DSH
itself would accept. Sessions below a Workspace path - a QA per-user
.qa-users/<uuid> root, for instance - cannot be adopted: the host compares the
cwd with the workspace path again on every read and would drop them.

Defaults: --home $DSH_HOME (or ~/.dsh), every registered Workspace, subagent
sessions left alone. Stop DSH before using --write; the registry is backed up
to *.pre-workspace-attach.bak first.`;
}

/**
 * @param argv - command line arguments without the interpreter and script.
 * @returns process exit code.
 */
export function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }
  const value = (name) => {
    const index = argv.indexOf(`--${name}`);
    if (index !== -1) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`--${name} needs a value`);
      }
      return next;
    }
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
    return inline?.slice(name.length + 3);
  };
  const known = new Set([
    "--write",
    "--help",
    "-h",
    "--include-subagents",
    "--home",
    "--workspace",
  ]);
  for (const arg of argv) {
    const name =
      arg.startsWith("--") && arg.includes("=")
        ? arg.slice(0, arg.indexOf("="))
        : arg;
    if (name.startsWith("-") && !known.has(name)) {
      throw new Error(`unknown option: ${name}`);
    }
  }

  const write = argv.includes("--write");
  const home =
    value("home") ??
    process.env.DSH_HOME?.trim() ??
    path.join(os.homedir(), ".dsh");
  if (!existsSync(path.join(home, REGISTRY_FILE))) {
    throw new Error(`${path.join(home, REGISTRY_FILE)} does not exist`);
  }
  if (write) console.error("write mode: DSH must be stopped");

  const plan = planAttachments({
    home,
    workspace: value("workspace"),
    includeSubagents: argv.includes("--include-subagents"),
  });
  if (plan.workspaces.length === 0) {
    throw new Error(
      `no registered workspace matched ${String(value("workspace"))}`,
    );
  }

  let attachable = 0;
  for (const entry of plan.workspaces) {
    if (entry.root === undefined) {
      console.log(
        `workspace ${entry.id} (${entry.path}): path does not resolve; skipped`,
      );
      continue;
    }
    attachable += entry.attachable.length;
    console.log(
      `workspace ${entry.id} (${entry.path}, "${entry.title}"): ${entry.members} member(s)`,
    );
    for (const session of entry.attachable) {
      console.log(
        `  adopt: ${session.id} <- ${session.cwd}${session.subagent ? " (subagent)" : ""}`,
      );
    }
    if (entry.below.length > 0) {
      console.log(
        `  refused ${entry.below.length} session(s) below the workspace path`,
      );
      console.log(
        `    (DSH membership is exact-path; e.g. ${entry.below[0].cwd})`,
      );
    }
    if (entry.unresolved.length > 0) {
      console.log(
        `  skipped ${entry.unresolved.length} session(s) whose cwd does not resolve now`,
      );
    }
    if (entry.archived > 0) {
      console.log(`  skipped ${entry.archived} archived session(s)`);
    }
    if (entry.refused > 0) {
      console.log(
        `  skipped ${entry.refused} subagent session(s); --include-subagents adopts them`,
      );
    }
  }

  const applied = applyPlan(plan, { write });
  for (const entry of applied.adopted) {
    console.log(
      `${applied.written ? "attached" : "would attach"} ${entry.ids.length} session(s) to ${entry.path}`,
    );
    if (applied.backup !== undefined) console.log(`backup: ${applied.backup}`);
  }
  console.log(
    `${write ? "attached" : "dry run"}: ${attachable} session(s) in ${plan.sessions} stored`,
  );
  if (!write && attachable > 0) {
    console.log("run again with --write to publish the repair");
  }
  return 0;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
