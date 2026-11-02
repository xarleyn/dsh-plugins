import { statSync } from "node:fs";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { DocumentsFace } from "@yadsh/dsh-documents";
import { canonicalCandidate, pathIsInside } from "./user-workspace.js";

interface SessionSource {
  readonly id: unknown;
  snapshotEvents?(): readonly unknown[];
}
interface Scope {
  readonly files: Set<string>;
  readonly members: Set<string>;
}
interface Binding {
  readonly scope: Scope;
  revoke?: (() => void) | undefined;
  published?: readonly string[] | undefined;
  ready?: Promise<void> | undefined;
  publisher?: object | undefined;
}
export interface QaAttachmentRecovery {
  readonly readEvents?: (sessionId: string) => Promise<readonly unknown[]>;
  readonly restoreFiles?: (sessionId: string) => Promise<void>;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Exact attachment capabilities, owned by one admitted conversation. */
export class QaAttachmentAccess {
  private readonly bindings = new Map<string, Binding>();

  constructor(
    private readonly ctx: Context,
    private readonly recovery: QaAttachmentRecovery = {},
  ) {}

  root(): string | undefined {
    const root = (this.ctx.get("attachments") as { root?: unknown } | undefined)
      ?.root;
    return typeof root === "string" ? root : undefined;
  }

  async admit(session: SessionSource): Promise<void> {
    const id = String(session.id);
    let binding = this.bindings.get(id);
    if (binding === undefined) {
      binding = { scope: { files: new Set(), members: new Set([id]) } };
      this.bindings.set(id, binding);
      const current = binding;
      binding.ready = (async () => {
        const events = (await this.recovery.readEvents?.(id)) ?? [];
        if (this.bindings.get(id) !== current) return;
        this.observe(id, events);
        this.observe(id, session.snapshotEvents?.() ?? []);
        await this.recovery.restoreFiles?.(id);
      })();
    }
    try {
      await binding.ready;
    } catch (error) {
      if (this.bindings.get(id) === binding) this.revoke(id);
      throw error;
    }
    // Also covers a prompt accepted while the durable prefix was loading.
    this.observe(id, session.snapshotEvents?.() ?? []);
    if (this.bindings.get(id) === binding) this.publish(binding.scope);
  }

  inherit(session: SessionSource, parentId: string): void {
    const parent = this.bindings.get(parentId);
    if (parent === undefined) return;
    const id = String(session.id);
    this.revoke(id);
    parent.scope.members.add(id);
    this.bindings.set(id, { scope: parent.scope });
    this.observe(id, session.snapshotEvents?.() ?? []);
    this.publish(parent.scope);
  }

  /** Only Host-admitted file blocks are authority; text and tool output are not. */
  observe(sessionId: string, events: readonly unknown[]): void {
    const binding = this.bindings.get(sessionId);
    if (binding === undefined) return;
    const host = this.ctx.get("attachments") as
      { fileHostPath?(ref: unknown): string | undefined } | undefined;
    for (const value of events) {
      const event = record(value);
      if (event?.type !== "user/message") continue;
      const content = record(event.data)?.content;
      if (!Array.isArray(content)) continue;
      for (const raw of content) {
        const part = record(raw);
        if (part?.type !== "file") continue;
        try {
          const file = host?.fileHostPath?.(part.attachment);
          if (file !== undefined) this.grantFile(sessionId, file);
        } catch {
          // Invalid or unsupported Host reference never widens access.
        }
      }
    }
    this.publish(binding.scope);
  }

  /** Called only after a durable form's bytes and session ownership are verified. */
  grantFile(sessionId: string, file: string): void {
    const binding = this.bindings.get(sessionId);
    const root = this.root();
    if (binding === undefined || root === undefined || !path.isAbsolute(file))
      return;
    try {
      const canonical = canonicalCandidate(file);
      if (
        !pathIsInside(canonical, canonicalCandidate(root)) ||
        !statSync(canonical).isFile()
      )
        return;
      if (binding.scope.files.has(canonical)) return;
      binding.scope.files.add(canonical);
      this.publish(binding.scope);
    } catch {
      // Missing bytes or a symlink outside the store are not a file grant.
    }
  }

  files(sessionId: string): readonly string[] {
    return [...(this.bindings.get(sessionId)?.scope.files ?? [])];
  }

  private publish(scope: Scope): void {
    const documents = this.ctx.get("documents") as
      Partial<Pick<DocumentsFace, "registerInputRoots">> | undefined;
    if (documents?.registerInputRoots === undefined) return;
    const files = [...scope.files];
    if (files.length === 0) return;
    for (const id of scope.members) {
      const binding = this.bindings.get(id);
      if (
        binding === undefined ||
        (binding.publisher === documents &&
          binding.published?.length === files.length)
      )
        continue;
      binding.revoke?.();
      binding.revoke = documents.registerInputRoots(id, files);
      binding.published = files;
      binding.publisher = documents;
    }
  }

  revoke(sessionId: string): void {
    const binding = this.bindings.get(sessionId);
    if (binding === undefined) return;
    this.bindings.delete(sessionId);
    binding.scope.members.delete(sessionId);
    binding.revoke?.();
  }

  dispose(): void {
    for (const id of this.bindings.keys()) this.revoke(id);
  }
}
