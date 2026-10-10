import { afterEach, describe, expect, it, vi } from "vitest";
import { QaSurface } from "../../src/index.js";
import { sharingFixture } from "./chat-sharing.helpers.js";
import { qaChatPublishedFile, qaChatAttachmentPath } from "../../src/chat-sharing/resources.js";
import type { Context } from "@deepseek-ai/cordis";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
describe("shared resources and privileged QA operations", () => {
  it("refuses participant approvals, question answers and directory browsing on the server", async () => {
    const f = sharingFixture(); cleanup.push(() => f.store.storage.close());
    const surface = Object.create(QaSurface.prototype) as QaSurface;
    const admission = { secureSession: vi.fn(async () => {}) };
    Object.assign(surface, { chatSharingStore: f.store, accountRemotes: { resolve: () => f.accounts },
      getConfig: () => ({ accounts: { enabled: true } }), admission });
    for (const token of [f.reader.token, f.collaborator.token, f.outsider.token]) {
      await expect(surface.answerApproval(token, "chat-a", "approval-demo", "allow-once" as never)).rejects.toThrow();
      await expect(surface.answerQuestion(token, "chat-a", "question-demo", [])).rejects.toThrow();
      await expect(surface.cancelQuestion(token, "chat-a", "question-demo")).rejects.toThrow();
      await expect(surface.approveDocumentWorkflow(token, "chat-a", "workflow-demo", 1, "a".repeat(64))).rejects.toThrow();
      await expect(surface.listWorkspaceFiles(token, "chat-a", "")).rejects.toThrow();
    }
    expect(admission.secureSession).not.toHaveBeenCalled();
  });
  it("reuses only published sources, structured produced outputs and exact attachment references", () => {
    const events = [
      { type: "user/message", data: { content: [{ type: "file", attachment: { attachmentId: "file-demo", name: "demo.txt", bytes: 3 } }] } },
      { type: "tool/call", data: { callId: "call-demo", name: "document_create" } },
      { type: "tool/result", data: { message: { source: { callId: "call-demo" }, content: [{ type: "text", text: "docx: .qa/artifacts/documents/demo/report.docx (20 B)" }] } } },
    ];
    const ctx = { sessions: { get: () => ({ header: { cwd: "/demo-workspace" }, snapshotEvents: () => events }) },
      get: () => ({ fileHostPath: () => "/demo-attachments/file-demo/demo.txt" }) } as unknown as Context;
    expect(qaChatPublishedFile(ctx, "chat-a", "/demo-workspace/source.md", (_id, path) => path.endsWith("source.md"))).toBe(true);
    expect(qaChatPublishedFile(ctx, "chat-a", ".qa/artifacts/documents/demo/report.docx", () => false)).toBe(true);
    expect(qaChatPublishedFile(ctx, "chat-a", "/demo-attachments/file-demo/demo.txt", () => false)).toBe(true);
    expect(qaChatPublishedFile(ctx, "chat-a", "/demo-workspace/credentials.txt", () => false)).toBe(false);
    expect(qaChatPublishedFile(ctx, "chat-a", "../private-account/report.docx", () => false)).toBe(false);
    expect(qaChatAttachmentPath(ctx, "chat-a", "file-demo")).toBe("/demo-attachments/file-demo/demo.txt");
    expect(() => qaChatAttachmentPath(ctx, "chat-a", "other-file")).toThrow("unavailable");
  });
  it("attests the owner's principal when a shared participant opens the chat", async () => {
    const f = sharingFixture(); cleanup.push(() => f.store.storage.close());
    const surface = Object.create(QaSurface.prototype) as QaSurface;
    const secureOwner = vi.fn(async () => ({ sessionId: "chat-a", enabled: true }));
    const principals = { attest: vi.fn() };
    Object.assign(surface, { chatSharingStore: f.store, accountRemotes: { resolve: () => f.accounts },
      getConfig: () => ({ accounts: { enabled: true, showOtherUsersChats: false } }),
      admission: { secureSessionForUser: secureOwner }, integrationPrincipals: principals,
      logger: { warn: vi.fn(), error: vi.fn() } });
    expect((await surface.secureSession(f.collaborator.token, "chat-a")).chatAccess?.mode).toBe("collaborate");
    expect(secureOwner).toHaveBeenCalledWith(f.owner.user.id, "chat-a");
    await expect(surface.secureSession(f.outsider.token, "chat-a")).rejects.toThrow();
    expect(principals.attest).not.toHaveBeenCalled();
  });
});
