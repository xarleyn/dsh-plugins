import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, open, rm } from "node:fs/promises";
import path from "node:path";
import {
  canonicalizeForContainment,
  isInsideRoot,
} from "../documents/security/paths.js";
import type { DocumentScope } from "../documents/orchestrator/scope.js";
import { WorkflowError, type DocumentWorkflow } from "./types.js";

/** Server-owned state, independent of editable Markdown. Callers cannot choose its root. */
export class WorkflowStore {
  constructor(readonly root: string) {}

  private async location(
    scope: DocumentScope,
    id: string,
  ): Promise<{ file: string; workspaceRoot: string; sessionId: string }> {
    if (!/^wf_[0-9a-f-]{36}$/u.test(id) || !scope.sessionId?.trim()) {
      throw new WorkflowError(
        "WORKFLOW_NOT_FOUND",
        "a workflow requires its owning session",
      );
    }
    const workspaceRoot = await canonicalizeForContainment(scope.workspaceRoot);
    if (
      isInsideRoot(workspaceRoot, await canonicalizeForContainment(this.root))
    ) {
      throw new WorkflowError(
        "WORKFLOW_STATE_NOT_PRIVATE",
        "workflow state must be outside the model-writable workspace",
      );
    }
    const sessionId = scope.sessionId;
    const owner = createHash("sha256")
      .update(JSON.stringify([sessionId, workspaceRoot]))
      .digest("hex");
    return {
      file: path.join(this.root, owner, `${id}.json`),
      workspaceRoot,
      sessionId,
    };
  }

  async read(scope: DocumentScope, id: string): Promise<DocumentWorkflow> {
    const owner = await this.location(scope, id);
    const text = await readFile(owner.file, "utf8").catch(() => undefined);
    if (text === undefined)
      throw new WorkflowError(
        "WORKFLOW_NOT_FOUND",
        "workflow is not available in this session",
      );
    const state = JSON.parse(text) as DocumentWorkflow;
    if (
      state.id !== id ||
      state.workspaceRoot !== owner.workspaceRoot ||
      state.sessionId !== owner.sessionId
    ) {
      throw new WorkflowError(
        "WORKFLOW_NOT_FOUND",
        "workflow ownership does not match",
      );
    }
    return state;
  }

  async create(
    scope: DocumentScope,
    state: Omit<DocumentWorkflow, "id" | "workspaceRoot" | "sessionId">,
  ): Promise<DocumentWorkflow> {
    const id = `wf_${randomUUID()}`;
    const owner = await this.location(scope, id);
    const record: DocumentWorkflow = {
      ...state,
      id,
      workspaceRoot: owner.workspaceRoot,
      sessionId: owner.sessionId,
    };
    await mkdir(path.dirname(owner.file), { recursive: true, mode: 0o700 });
    await writeFile(owner.file, JSON.stringify(record), {
      flag: "wx",
      mode: 0o600,
    });
    const pointer = path.join(path.dirname(owner.file), "active.json");
    const temporary = `${pointer}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ id }), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, pointer);
    return record;
  }

  async hasActive(scope: DocumentScope): Promise<boolean> {
    if (scope.sessionId === undefined) return false;
    const owner = await this.location(
      scope,
      "wf_00000000-0000-0000-0000-000000000000",
    );
    const text = await readFile(
      path.join(path.dirname(owner.file), "active.json"),
      "utf8",
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (text === undefined) return false;
    const { id } = JSON.parse(text) as { id: string };
    await this.read(scope, id);
    return true;
  }

  /** Cross-instance/process serialization. Network reviews are deliberately outside this lock. */
  async update(
    scope: DocumentScope,
    id: string,
    change: (
      state: DocumentWorkflow,
    ) => Promise<DocumentWorkflow> | DocumentWorkflow,
  ): Promise<DocumentWorkflow> {
    const owner = await this.location(scope, id);
    const lock = `${owner.file}.lock`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        handle = await open(lock, "wx", 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const holder = await readFile(lock, "utf8").catch(() => "");
        const pid = Number(holder);
        if (Number.isSafeInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (probe) {
            if ((probe as NodeJS.ErrnoException).code === "ESRCH") {
              await rm(lock).catch(() => {});
              continue;
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    if (handle === undefined)
      throw new WorkflowError(
        "WORKFLOW_BUSY",
        "another workflow update is in progress; retry",
      );
    const temporary = `${owner.file}.${randomUUID()}.tmp`;
    try {
      await handle.writeFile(String(process.pid));
      const changed = await change(await this.read(scope, id));
      if (
        changed.id !== id ||
        changed.sessionId !== owner.sessionId ||
        changed.workspaceRoot !== owner.workspaceRoot
      ) {
        throw new WorkflowError(
          "WORKFLOW_NOT_FOUND",
          "workflow ownership cannot change",
        );
      }
      await writeFile(temporary, JSON.stringify(changed), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, owner.file);
      return changed;
    } finally {
      await handle.close();
      await rm(temporary, { force: true });
      await rm(lock, { force: true });
    }
  }
}
