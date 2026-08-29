import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { ZodError } from "zod";
import {
  DEFAULT_MAX_DRAFTS_PER_WORKSPACE,
  DRAFT_FILE_VERSION,
  DRAFT_SESSION_VERSION,
} from "../shared/constants.js";
import type {
  CreateDraftRequest,
  DeleteDraftRequest,
  DraftFile,
  DraftSession,
  ListDraftsRequest,
  RebindDraftRequest,
  UpdateDraftRequest,
} from "../shared/types.js";
import { DraftStoreError } from "./errors.js";
import { draftFileSchema } from "./schema.js";

export interface DraftStoreOptions {
  readonly storagePath?: string;
  readonly maxDraftsPerWorkspace?: number;
  readonly now?: () => number;
  readonly id?: () => string;
}

function defaultStoragePath(): string {
  const configuredHome = process.env.DSH_HOME?.trim();
  const dshHome =
    configuredHome === undefined || configuredHome === ""
      ? join(homedir(), ".dsh")
      : resolve(configuredHome);
  return join(dshHome, "storages", "dsh-draft-sessions", "drafts.json");
}

function storagePath(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return defaultStoragePath();
  return isAbsolute(value) ? value : resolve(value);
}

function positiveLimit(value: number | undefined): number {
  const resolvedValue = value ?? DEFAULT_MAX_DRAFTS_PER_WORKSPACE;
  if (!Number.isSafeInteger(resolvedValue) || resolvedValue < 1) {
    throw new DraftStoreError(
      "maxDraftsPerWorkspace must be a positive safe integer",
      "DRAFT_INVALID_INPUT",
    );
  }
  return resolvedValue;
}

function requiredText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DraftStoreError(
      `${field} must be a non-empty string`,
      "DRAFT_INVALID_INPUT",
    );
  }
  return value;
}

function optionalNonBlank(
  value: string | undefined,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field);
}

function orderValue(value: number, field = "order"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DraftStoreError(
      `${field} must be a non-negative safe integer`,
      "DRAFT_INVALID_INPUT",
    );
  }
  return value;
}

function revisionValue(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DraftStoreError(
      "expectedRevision must be a positive safe integer",
      "DRAFT_INVALID_INPUT",
    );
  }
  return value;
}

function cloneDraft(draft: DraftSession): DraftSession {
  return structuredClone(draft);
}

function sorted(drafts: readonly DraftSession[]): DraftSession[] {
  return [...drafts].sort(
    (left, right) =>
      Number(right.pinned === true) - Number(left.pinned === true) ||
      left.order - right.order ||
      left.createdAt - right.createdAt ||
      left.id.localeCompare(right.id),
  );
}

/** Serialized, atomically persisted authority for unsent draft sessions. */
export class DraftStore {
  readonly path: string;
  readonly maxDraftsPerWorkspace: number;

  private readonly now: () => number;
  private readonly id: () => string;
  private drafts: DraftSession[] | undefined;
  private queue = Promise.resolve();

  constructor(options: DraftStoreOptions = {}) {
    this.path = storagePath(options.storagePath);
    this.maxDraftsPerWorkspace = positiveLimit(options.maxDraftsPerWorkspace);
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
  }

  list(request: ListDraftsRequest = {}): Promise<DraftSession[]> {
    return this.enqueue(async () => {
      const drafts = await this.loaded();
      const selected =
        request.workspaceId === undefined
          ? drafts
          : drafts.filter((draft) => draft.workspaceId === request.workspaceId);
      return sorted(selected).map(cloneDraft);
    });
  }

  create(request: CreateDraftRequest): Promise<DraftSession> {
    return this.enqueue(async () => {
      const current = await this.loaded();
      const workspaceId = requiredText(request.workspaceId, "workspaceId");
      const workspaceDrafts = current.filter(
        (draft) => draft.workspaceId === workspaceId,
      );
      if (workspaceDrafts.length >= this.maxDraftsPerWorkspace) {
        throw new DraftStoreError(
          `workspace already has ${this.maxDraftsPerWorkspace} drafts`,
          "DRAFT_LIMIT_REACHED",
        );
      }
      const now = this.now();
      const sessionId = request.sessionId ?? null;
      if (sessionId !== null) requiredText(sessionId, "sessionId");
      const draft: DraftSession = {
        version: DRAFT_SESSION_VERSION,
        id: requiredText(this.id(), "generated id"),
        sessionId,
        workspaceId,
        ...(optionalNonBlank(request.workspacePath, "workspacePath") ===
        undefined
          ? {}
          : { workspacePath: request.workspacePath }),
        text: request.text ?? "",
        ...(optionalNonBlank(request.title, "title") === undefined
          ? {}
          : { title: request.title }),
        createdAt: now,
        updatedAt: now,
        order:
          request.order === undefined
            ? Math.max(-1, ...workspaceDrafts.map((item) => item.order)) + 1
            : orderValue(request.order),
        ...(request.pinned === undefined ? {} : { pinned: request.pinned }),
        ...(optionalNonBlank(request.agentPresetId, "agentPresetId") ===
        undefined
          ? {}
          : { agentPresetId: request.agentPresetId }),
        state: sessionId === null ? "draft" : "ready",
        revision: 1,
      };
      await this.commit([...current, draft]);
      return cloneDraft(draft);
    });
  }

  update(request: UpdateDraftRequest): Promise<DraftSession> {
    return this.enqueue(async () => {
      const current = await this.loaded();
      const index = this.find(current, request.id);
      const previous = current[index] as DraftSession;
      this.expectRevision(previous, request.expectedRevision);
      const now = Math.max(this.now(), previous.updatedAt);
      const next: DraftSession = {
        ...previous,
        ...(request.text === undefined ? {} : { text: request.text }),
        ...(request.order === undefined
          ? {}
          : { order: orderValue(request.order) }),
        ...(request.pinned === undefined ? {} : { pinned: request.pinned }),
        ...(request.state === undefined ? {} : { state: request.state }),
        updatedAt: now,
        revision: previous.revision + 1,
      };
      const mutable = { ...next } as {
        title?: string;
        agentPresetId?: string;
        lastError?: string;
      } & DraftSession;
      if (request.title === null) delete mutable.title;
      else if (request.title !== undefined)
        mutable.title = requiredText(request.title, "title");
      if (request.agentPresetId === null) delete mutable.agentPresetId;
      else if (request.agentPresetId !== undefined) {
        mutable.agentPresetId = requiredText(
          request.agentPresetId,
          "agentPresetId",
        );
      }
      if (request.lastError === null) delete mutable.lastError;
      else if (request.lastError !== undefined) {
        mutable.lastError = requiredText(request.lastError, "lastError");
      }
      const changed = [...current];
      changed[index] = mutable;
      await this.commit(changed);
      return cloneDraft(mutable);
    });
  }

  delete(request: DeleteDraftRequest): Promise<boolean> {
    return this.enqueue(async () => {
      const current = await this.loaded();
      const index = current.findIndex((draft) => draft.id === request.id);
      if (index < 0) return false;
      const previous = current[index] as DraftSession;
      if (request.expectedRevision !== undefined) {
        this.expectRevision(previous, request.expectedRevision);
      }
      const changed = current.filter((_, draftIndex) => draftIndex !== index);
      await this.commit(changed);
      return true;
    });
  }

  rebind(request: RebindDraftRequest): Promise<DraftSession> {
    return this.enqueue(async () => {
      const current = await this.loaded();
      const index = this.find(current, request.id);
      const previous = current[index] as DraftSession;
      this.expectRevision(previous, request.expectedRevision);
      if (request.sessionId !== null)
        requiredText(request.sessionId, "sessionId");
      const next: DraftSession = {
        ...previous,
        sessionId: request.sessionId,
        state: request.sessionId === null ? "draft" : "ready",
        updatedAt: Math.max(this.now(), previous.updatedAt),
        revision: previous.revision + 1,
      };
      const rebound = { ...next } as DraftSession & { lastError?: string };
      delete rebound.lastError;
      const changed = [...current];
      changed[index] = rebound;
      await this.commit(changed);
      return cloneDraft(rebound);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async loaded(): Promise<DraftSession[]> {
    if (this.drafts !== undefined) return this.drafts;
    let contents: string;
    try {
      contents = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.drafts = [];
        return this.drafts;
      }
      throw error;
    }
    try {
      const parsed = draftFileSchema.parse(JSON.parse(contents)) as DraftFile;
      const seen = new Set<string>();
      for (const draft of parsed.drafts) {
        if (seen.has(draft.id)) {
          throw new DraftStoreError(
            `storage contains duplicate draft id ${JSON.stringify(draft.id)}`,
            "DRAFT_STORAGE_INVALID",
          );
        }
        seen.add(draft.id);
      }
      this.drafts = parsed.drafts.map(cloneDraft);
      return this.drafts;
    } catch (error) {
      if (error instanceof DraftStoreError) throw error;
      const detail =
        error instanceof ZodError
          ? error.issues.map((issue) => issue.message).join("; ")
          : error instanceof Error
            ? error.message
            : String(error);
      throw new DraftStoreError(
        `invalid draft storage: ${detail}`,
        "DRAFT_STORAGE_INVALID",
      );
    }
  }

  private find(drafts: readonly DraftSession[], id: string): number {
    requiredText(id, "id");
    const index = drafts.findIndex((draft) => draft.id === id);
    if (index < 0) {
      throw new DraftStoreError(
        `draft ${JSON.stringify(id)} was not found`,
        "DRAFT_NOT_FOUND",
      );
    }
    return index;
  }

  private expectRevision(draft: DraftSession, expectedRevision: number): void {
    revisionValue(expectedRevision);
    if (draft.revision !== expectedRevision) {
      throw new DraftStoreError(
        `draft ${JSON.stringify(draft.id)} is at revision ${draft.revision}, not ${expectedRevision}`,
        "DRAFT_STALE_REVISION",
      );
    }
  }

  private async commit(drafts: DraftSession[]): Promise<void> {
    const document: DraftFile = { version: DRAFT_FILE_VERSION, drafts };
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true });
    const temporary = join(
      directory,
      `.${basename(this.path)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    this.drafts = drafts;
  }
}
