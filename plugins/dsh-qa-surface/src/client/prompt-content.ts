import type { SessionFace } from "@deepseek-ai/dsh-api-session-controller/client";
import type { QaAttachmentDraft, QaFileDraft } from "../types.js";
import type { QaFileUpload, QaPromptContent } from "./types.js";

/**
 * Stage every pending file on the Host and collect the receipts the prompt
 * cites. Sequential on purpose: a partial batch must be attributable to the
 * exact file that failed, and the visitor's file counts are small.
 * `service` is undefined on a page the deployment serves without the upload
 * plugin, which leaves attachments unavailable rather than broken. The
 * receipt is opaque and host-minted — the upload service answers with a
 * plain string, and only the session wire brand knows it as an id.
 */
export async function stageQaFiles(
  service: QaFileUpload | undefined,
  session: SessionFace,
  files: readonly QaFileDraft[],
): Promise<
  | { readonly kind: "ok"; readonly receipts: Map<string, string> }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" }
> {
  if (service === undefined) return { kind: "unavailable" };
  const receipts = new Map<string, string>();
  for (const file of files) {
    try {
      const result = await service.upload(
        session.sessionId,
        file.blob,
        file.name,
      );
      if (!result.ok) {
        console.error("dsh-qa-surface: file upload refused", result.error);
        return { kind: "failed" };
      }
      receipts.set(file.id, result.value.receiptId);
    } catch (error) {
      console.error("dsh-qa-surface: file upload failed", error);
      return { kind: "failed" };
    }
  }
  return { kind: "ok", receipts };
}

/**
 * Assemble the wire content of one prompt: the text part, images riding the
 * prompt inline, and files cited by their staged receipts. The visitor's own
 * order decides the prompt order, so images and files are assembled from one
 * walk over the drafts; an unpaired file receipt (a draft kept while its
 * staging failed elsewhere) degrades to an empty receipt rather than
 * dropping the attachment.
 */
export function buildQaPromptContent(
  prompt: string,
  attachments: readonly QaAttachmentDraft[],
  receipts: ReadonlyMap<string, string>,
): QaPromptContent {
  return [
    ...(prompt === "" ? [] : [{ type: "text" as const, text: prompt }]),
    ...attachments.map((attachment) =>
      attachment.kind === "image"
        ? {
            type: "image" as const,
            mediaType: attachment.mediaType,
            data: attachment.data,
            name: attachment.name,
          }
        : {
            type: "file" as const,
            receiptId: receipts.get(attachment.id) ?? "",
          },
    ),
  ] as QaPromptContent;
}
