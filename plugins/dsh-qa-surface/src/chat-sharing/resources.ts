import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { artifactsOfToolResult } from "../client/chat-artifacts.js";

/** Paths reach recipients only through the chat's sources or reported outputs. */
export function qaChatPublishedFile(ctx: Context, id: string, requested: string,
  sourceAllowed: (id: string, path: string) => boolean): boolean {
  const session = ctx.sessions.get(SessionId(id));
  const cwd = session?.header.cwd;
  if (session === undefined || cwd === undefined) return false;
  const target = path.resolve(cwd, requested);
  if (sourceAllowed(id, target)) return true;
  const calls = new Map<string, string>();
  for (const event of session.snapshotEvents()) {
    if (event.type === "user/message") {
      const attachments = ctx.get("attachments") as { fileHostPath?(ref: unknown): string | undefined } | undefined;
      if (event.data.content.some(block => {
        if (block.type !== "file") return false;
        const hostPath = attachments?.fileHostPath?.(block.attachment);
        return hostPath !== undefined && path.resolve(cwd, hostPath) === target;
      })) return true;
    }
    if (event.type === "tool/call") calls.set(String(event.data.callId), event.data.name);
    if (event.type !== "tool/result" || event.data.error !== undefined) continue;
    const name = calls.get(String(event.data.message.source.callId));
    if (name === undefined) continue;
    const output = event.data.message.content.map(part => part.type === "text" ? part.text : "").join("\n");
    if (artifactsOfToolResult(name, output).some(file => path.resolve(cwd, file.path) === target)) return true;
  }
  return false;
}

export function qaChatAttachmentPath(ctx: Context, id: string, attachmentId: string): string {
  const session = ctx.sessions.get(SessionId(id));
  const attachments = ctx.get("attachments") as { fileHostPath?(ref: unknown): string | undefined } | undefined;
  for (const event of session?.snapshotEvents() ?? []) {
    if (event.type !== "user/message") continue;
    for (const block of event.data.content) {
      if (block.type !== "file" || String(block.attachment.attachmentId) !== attachmentId) continue;
      const filePath = attachments?.fileHostPath?.(block.attachment);
      if (filePath !== undefined) return filePath;
    }
  }
  throw new Error("This attachment is unavailable in the chat.");
}
