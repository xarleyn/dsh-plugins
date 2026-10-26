import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { readZipEntries, readZipEntry } from "@yadsh/dsh-documents";
import { z } from "zod";
import { formAssert, QaFormError } from "./errors.js";
import { parseFormSchema } from "./schema.js";
import type { QaFormService } from "./service.js";
import type {
  QaFormAttachment,
  QaFormRecord,
  QaFormSubmission,
} from "./types.js";

const fileRef = z.object({
  attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  name: z.string().min(1),
  bytes: z.number().int().positive(),
});
const receipt = z.object({ receiptId: z.string().min(1), file: fileRef });
type FileRef = z.infer<typeof fileRef>;
/** Structural port to the installed Host; receipt data is runtime-validated. */
export interface QaFormHostAttachments {
  readonly root: string;
  readFileStream(
    file: FileRef,
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array>;
  saveFile(input: { data: Uint8Array; name: string }): Promise<unknown>;
  fileHostPath(file: FileRef): string | undefined;
  validateImage?(input: {
    data: Uint8Array;
    mediaType: "image/png" | "image/jpeg";
    name: string;
  }): Promise<void>;
}

export function validateFormFile(name: string, data: Buffer): string {
  const ext = path.extname(name).toLowerCase();
  const check = (ok: unknown) =>
    formAssert(
      ok,
      "FILE_INVALID",
      "The file content does not match its declared format.",
    );
  check(data.length > 0);
  if (ext === ".txt" || ext === ".csv") {
    check(!data.includes(0));
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      check(false);
    }
    return ext === ".csv" ? "text/csv" : "text/plain";
  }
  if (ext === ".pdf") {
    check(
      data.subarray(0, 5).toString("ascii") === "%PDF-" &&
        data.subarray(-2048).includes(Buffer.from("%%EOF")),
    );
    return "application/pdf";
  }
  if (ext === ".png") {
    check(
      data
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        data.length >= 33,
    );
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    check(
      data[0] === 255 &&
        data[1] === 216 &&
        data[2] === 255 &&
        data.at(-2) === 255 &&
        data.at(-1) === 217,
    );
    return "image/jpeg";
  }
  if (ext === ".docx" || ext === ".xlsx") {
    const entries = readZipEntries(data);
    check(entries && entries.length <= 10000);
    const parts = entries!;
    check(
      new Set(parts.map((p) => p.name)).size === parts.length &&
        parts.every(
          (p) =>
            p.uncompressedSize <= 64 * 1024 * 1024 &&
            !/vbaProject|(^|\/)\.\.(\/|$)/iu.test(p.name),
        ) &&
        parts.reduce((n, p) => n + p.uncompressedSize, 0) <= 128 * 1024 * 1024,
    );
    const expected = ext === ".docx" ? "word/document.xml" : "xl/workbook.xml";
    for (const required of ["[Content_Types].xml", "_rels/.rels", expected]) {
      const entry = parts.find((p) => p.name === required);
      check(entry && entry.uncompressedSize <= 4 * 1024 * 1024);
      const bytes = readZipEntry(data, entry!);
      check(
        bytes &&
          bytes.length <= 4 * 1024 * 1024 &&
          !/<!DOCTYPE|<!ENTITY|macroEnabled/iu.test(bytes.toString("utf8")),
      );
    }
    return ext === ".docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  throw new QaFormError("FILE_TYPE_NOT_ALLOWED", "Unsupported file format.");
}

/** Durable bytes belong to the form store; Host objects are verified reader projections. */
export class QaFormAttachmentAdapter {
  constructor(
    private readonly service: () => QaFormService,
    private readonly host: () => QaFormHostAttachments | undefined,
  ) {}
  available(): boolean {
    const host = this.host();
    return (
      host !== undefined &&
      typeof host.root === "string" &&
      path.isAbsolute(host.root) &&
      typeof host.readFileStream === "function" &&
      typeof host.saveFile === "function" &&
      typeof host.fileHostPath === "function"
    );
  }
  check(session: string, formId: string, uploadId: string): void {
    const s = this.service();
    s.enabled();
    const r = s.get(session, formId),
      u = r.uploads.find((v) => v.id === uploadId);
    formAssert(
      r.status === "draft" &&
        u?.state === "uploading" &&
        u.expires_at > Date.now(),
      "UPLOAD_FAILED",
      "This upload is no longer active.",
    );
    parseFormSchema(r.schema, s.policy());
  }
  claim(
    session: string,
    uploadId: string,
  ): { record: QaFormRecord; upload: QaFormRecord["uploads"][number] } {
    const s = this.service();
    s.enabled();
    formAssert(
      this.available(),
      "INTERACTION_UNAVAILABLE",
      "The Host has no durable local file projection.",
    );
    const record = s.store
      .list(session)
      .find((r) => r.uploads.some((u) => u.id === uploadId));
    formAssert(record, "ACCESS_DENIED", "Upload access is unavailable.");
    const updated = s.store.update(session, record.id, (r) => {
      const u = r.uploads.find((v) => v.id === uploadId)!;
      formAssert(
        r.status === "draft" &&
          u.state === "pending" &&
          u.expires_at > Date.now(),
        "UPLOAD_FAILED",
        "This upload is no longer pending. Check its saved state before retrying.",
      );
      u.state = "uploading";
    });
    return {
      record: updated,
      upload: updated.uploads.find((u) => u.id === uploadId)!,
    };
  }
  async complete(
    session: string,
    formId: string,
    uploadId: string,
    raw: unknown,
    signal: AbortSignal,
    authorize: () => void,
  ): Promise<QaFormRecord> {
    const s = this.service(),
      host = this.host();
    formAssert(
      host,
      "INTERACTION_UNAVAILABLE",
      "This Host cannot retain and read form files.",
    );
    const parsed = receipt.safeParse(raw);
    formAssert(
      parsed.success,
      "FILE_UNAVAILABLE",
      "The Host returned an unsupported upload receipt.",
    );
    const r = s.get(session, formId),
      u = r.uploads.find((v) => v.id === uploadId);
    formAssert(
      u && u.state === "uploading",
      "UPLOAD_FAILED",
      "This upload is no longer active.",
    );
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of host.readFileStream(parsed.data.file, signal)) {
      signal.throwIfAborted();
      authorize();
      size += chunk.byteLength;
      formAssert(
        size <= u.size_bytes && size <= s.policy().maxFileSizeBytes,
        "FILE_TOO_LARGE",
        "The uploaded file exceeds its reserved size.",
      );
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks),
      hash = createHash("sha256").update(bytes).digest("hex");
    formAssert(
      size === u.size_bytes &&
        size === parsed.data.file.bytes &&
        parsed.data.file.attachmentId === `sha256:${hash}`,
      "FILE_INVALID",
      "The uploaded file failed its integrity check.",
    );
    const mediaType = validateFormFile(u.name, bytes);
    if (mediaType === "image/png" || mediaType === "image/jpeg") {
      formAssert(
        typeof host.validateImage === "function",
        "FILE_TYPE_NOT_ALLOWED",
        "This Host cannot validate image files.",
      );
      try {
        await host.validateImage({ data: bytes, mediaType, name: u.name });
      } catch {
        throw new QaFormError(
          "FILE_INVALID",
          "The image failed the Host's content and dimension checks.",
        );
      }
    }
    signal.throwIfAborted();
    authorize();
    s.enabled();
    return s.store.update(session, formId, (record) => {
      parseFormSchema(record.schema, s.policy());
      const intent = record.uploads.find((v) => v.id === uploadId)!;
      formAssert(
        record.status === "draft" &&
          intent.state === "uploading" &&
          intent.expires_at > Date.now(),
        "UPLOAD_FAILED",
        "This upload was cancelled or expired.",
      );
      const active = record.attachments[intent.item_id] ?? [];
      formAssert(
        !active.some((a) => a.sha256 === hash),
        "FILE_INVALID",
        "This item already contains the same file.",
      );
      if (intent.target)
        formAssert(
          active.some(
            (a) =>
              a.attachment_id === intent.target?.attachment_id &&
              a.version === intent.target.version,
          ),
          "ATTACHMENT_VERSION_CONFLICT",
          "The replaced file changed while uploading.",
        );
      const result: QaFormAttachment = {
        attachment_id: intent.target?.attachment_id ?? randomUUID(),
        version: (intent.target?.version ?? 0) + 1,
        name: intent.name,
        size_bytes: size,
        media_type: mediaType,
        sha256: hash,
        resource_id: randomUUID(),
      };
      s.store.saveResource(formId, result.resource_id, bytes);
      record.attachments[intent.item_id] = [
        ...active.filter((a) => a.attachment_id !== result.attachment_id),
        result,
      ];
      intent.state = "ready";
      intent.result = result;
    });
  }
  fail(session: string, formId: string, uploadId: string): void {
    const prior = this.service().get(session, formId);
    if (
      prior.status !== "draft" ||
      !prior.uploads.some((u) => u.id === uploadId && u.state === "uploading")
    )
      return;
    this.service().store.update(session, formId, (r) => {
      const u = r.uploads.find((v) => v.id === uploadId);
      if (u?.state === "uploading") {
        u.state = "failed";
        u.error = "UPLOAD_FAILED";
      }
    });
  }
  /** Exact saved bytes are re-projected through the Host on each successful resume. */
  async readable(submission: QaFormSubmission): Promise<
    QaFormSubmission & {
      resources: { resource_id: string; read_path: string }[];
    }
  > {
    const resources: { resource_id: string; read_path: string }[] = [];
    for (const item of submission.items)
      for (const file of item.files) {
        const host = this.host();
        formAssert(
          host,
          "FILE_UNAVAILABLE",
          "The Host file reader is unavailable.",
        );
        const data = this.service().store.resource(
          submission.form_id,
          file.resource_id,
        );
        formAssert(
          createHash("sha256").update(data).digest("hex") === file.sha256,
          "FILE_UNAVAILABLE",
          "The saved file failed its integrity check.",
        );
        const raw = await host.saveFile({ data, name: file.name }),
          parsed = fileRef.safeParse(raw);
        formAssert(
          parsed.success &&
            parsed.data.attachmentId === `sha256:${file.sha256}`,
          "FILE_UNAVAILABLE",
          "The Host cannot project the saved version.",
        );
        const readPath = host.fileHostPath(parsed.data);
        formAssert(
          readPath &&
            path.isAbsolute(readPath) &&
            path.relative(host.root, readPath) !== "" &&
            !path.relative(host.root, readPath).startsWith("..") &&
            !path.isAbsolute(path.relative(host.root, readPath)),
          "FILE_UNAVAILABLE",
          "The Host has no file reader projection.",
        );
        resources.push({ resource_id: file.resource_id, read_path: readPath });
      }
    return { ...submission, resources };
  }
}
