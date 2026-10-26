import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { formAssert, QaFormError } from "./errors.js";
import { parseFormSchema } from "./schema.js";
import {
  formAnswerParser,
  normalizeFormAnswer,
  validateForm,
} from "./validation.js";
import type {
  QaFormCommand,
  QaFormPolicy,
  QaFormRecord,
  QaFormStoreApi,
  QaFormUpload,
  QaFormView,
} from "./types.js";

const mutation = {
  form_id: z.string().min(1),
  expected_revision: z.number().int().nonnegative(),
  mutation_id: z.string().min(1).max(100),
};
const target = z
  .object({ attachment_id: z.string(), version: z.number().int().positive() })
  .strict();
const commandParser = z.discriminatedUnion("action", [
  z
    .object({
      ...mutation,
      action: z.literal("save"),
      answers: z.record(z.string(), z.union([formAnswerParser, z.null()])),
      step: z.number().int().nonnegative(),
    })
    .strict(),
  ...(["submit", "pause"] as const).map((action) =>
    z.object({ ...mutation, action: z.literal(action) }).strict(),
  ),
  z
    .object({
      ...mutation,
      action: z.literal("begin_upload"),
      item_id: z.string(),
      name: z.string().min(1).max(240),
      size_bytes: z.number().int().positive(),
      target: target.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal("cancel_upload"),
      upload_id: z.string(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal("remove"),
      item_id: z.string(),
      attachment_id: z.string(),
      version: z.number().int().positive(),
    })
    .strict(),
]);

export class QaFormService {
  constructor(
    readonly store: QaFormStoreApi,
    readonly policy: () => Readonly<QaFormPolicy>,
    private readonly ownerOf: (session: string) => string = (id) => id,
  ) {}
  enabled(): void {
    formAssert(
      this.policy().enabled,
      "INTERACTION_UNAVAILABLE",
      "Forms are disabled on this deployment.",
    );
  }
  create(session: string, key: string, input: unknown): QaFormRecord {
    this.enabled();
    formAssert(
      typeof key === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(key),
      "INVALID_SCHEMA",
      "Provide a stable request_key.",
    );
    return this.store.create(
      session,
      key,
      parseFormSchema(input, this.policy()),
      this.ownerOf(session),
    );
  }
  view(record: QaFormRecord, waiting = false): QaFormView {
    return {
      ...record,
      waiting,
      field_errors: validateForm(record, this.policy()),
    };
  }
  get(session: string, id: string): QaFormRecord {
    return this.store.get(session, id);
  }
  step(session: string, id: string, stepId: string, revision: number): void {
    const r = this.get(session, id);
    formAssert(
      r.revision === revision,
      "REVISION_CONFLICT",
      "The form changed. Reload the saved draft.",
    );
    formAssert(
      r.schema.steps.some((s) => s.id === stepId),
      "INVALID_REQUEST",
      "Unknown form step.",
    );
    const errors = validateForm(r, this.policy(), stepId);
    if (errors.length)
      throw new QaFormError(
        "FORM_INCOMPLETE",
        "Заполните обязательные пункты шага.",
        r.revision,
        errors,
      );
  }
  command(session: string, raw: unknown): QaFormRecord {
    this.enabled();
    const parsed = commandParser.safeParse(raw);
    formAssert(parsed.success, "INVALID_REQUEST", "Unsupported form mutation.");
    const c: QaFormCommand = parsed.data;
    const existing = this.get(session, c.form_id);
    // New submit retries may use a fresh key, but cannot create a second snapshot.
    if (c.action === "submit" && existing.status === "submitted") {
      return (
        this.store.replayedMutation(c.form_id, c.mutation_id, c) ?? existing
      );
    }
    return this.store.mutate(
      session,
      c.form_id,
      c.expected_revision,
      c.mutation_id,
      c,
      (r) => {
        parseFormSchema(r.schema, this.policy());
        if (c.action === "save") {
          const items = r.schema.steps.flatMap((s) => s.items);
          for (const [id, value] of Object.entries(c.answers)) {
            const item = items.find((i) => i.id === id);
            formAssert(
              item?.answer !== undefined,
              "INVALID_ANSWER",
              "Unknown answer field.",
            );
            r.answers[id] = normalizeFormAnswer(
              item.answer,
              value,
              this.policy(),
            );
          }
          formAssert(
            Buffer.byteLength(JSON.stringify(r.answers)) <=
              this.policy().maxTotalAnswerBytes,
            "QUOTA_EXCEEDED",
            "The answers exceed the form limit.",
          );
          formAssert(
            c.step <= r.schema.steps.length,
            "INVALID_REQUEST",
            "Unknown form step.",
          );
          if (c.step > r.step) {
            const preceding = new Set(
              r.schema.steps.slice(0, c.step).map((s) => s.id),
            );
            const errors = validateForm(r, this.policy()).filter((e) =>
              preceding.has(e.step_id),
            );
            if (errors.length)
              throw new QaFormError(
                "FORM_INCOMPLETE",
                "Заполните обязательные пункты шага.",
                r.revision,
                errors,
              );
          }
          r.step = c.step;
        } else if (c.action === "begin_upload") this.beginUpload(r, c);
        else if (c.action === "cancel_upload") {
          const upload = r.uploads.find((u) => u.id === c.upload_id);
          formAssert(
            upload && upload.state !== "ready",
            "INVALID_REQUEST",
            "This upload cannot be cancelled.",
          );
          upload.state = "cancelled";
        } else if (c.action === "remove") {
          const active = r.attachments[c.item_id] ?? [];
          formAssert(
            active.some(
              (a) =>
                a.attachment_id === c.attachment_id && a.version === c.version,
            ),
            "ATTACHMENT_VERSION_CONFLICT",
            "The attachment version changed.",
          );
          r.attachments[c.item_id] = active.filter(
            (a) => a.attachment_id !== c.attachment_id,
          );
          for (const u of r.uploads)
            if (
              u.target?.attachment_id === c.attachment_id &&
              u.state !== "ready"
            )
              u.state = "cancelled";
        } else if (c.action === "submit") {
          formAssert(
            Object.values(r.attachments)
              .flat()
              .reduce((n, a) => n + a.size_bytes, 0) <=
              this.policy().maxTotalFileBytesPerForm &&
              Buffer.byteLength(JSON.stringify(r.answers)) <=
                this.policy().maxTotalAnswerBytes,
            "QUOTA_EXCEEDED",
            "The saved form exceeds the current policy. Reduce the draft before submitting.",
          );
          const errors = validateForm(r, this.policy());
          if (errors.length)
            throw new QaFormError(
              "FORM_INCOMPLETE",
              "Заполните обязательные пункты формы.",
              r.revision,
              errors,
            );
          const items = r.schema.steps.flatMap((s) =>
            s.items.map((i) => ({
              step_id: s.id,
              item_id: i.id,
              answer: normalizeFormAnswer(
                i.answer,
                r.answers[i.id],
                this.policy(),
                true,
              ),
              files: r.attachments[i.id] ?? [],
            })),
          );
          // Validate durable ownership/readability from server resources, never client counters.
          for (const item of items)
            for (const file of item.files) {
              const data = this.store.resource(r.id, file.resource_id);
              formAssert(
                data.byteLength === file.size_bytes &&
                  createHash("sha256").update(data).digest("hex") ===
                    file.sha256,
                "FILE_UNAVAILABLE",
                "A saved file failed its integrity check.",
              );
            }
          r.status = "submitted";
          r.submission = {
            status: "submitted",
            form_id: r.id,
            submission_id: randomUUID(),
            schema_version: 1,
            schema_hash: r.schema_hash,
            form_revision: r.revision + 1,
            submitted_at: new Date().toISOString(),
            items,
            empty_optional_item_ids: items
              .filter((i) => i.answer === null && i.files.length === 0)
              .map((i) => i.item_id),
          };
        }
      },
    );
  }
  private beginUpload(
    r: QaFormRecord,
    c: Extract<QaFormCommand, { action: "begin_upload" }>,
  ): void {
    const item = r.schema.steps
      .flatMap((s) => s.items)
      .find((i) => i.id === c.item_id);
    formAssert(
      item && item.files.requirement !== "none",
      "FILE_TYPE_NOT_ALLOWED",
      "Files are not allowed for this item.",
    );
    const f = item.files,
      active = r.attachments[item.id] ?? [];
    formAssert(
      !/[\\/]/u.test(c.name) &&
        Array.from(c.name).every(
          (ch) => (ch.codePointAt(0) ?? 0) > 31 && ch.codePointAt(0) !== 127,
        ) &&
        f.accept.some((ext) => c.name.toLowerCase().endsWith(ext)),
      "FILE_TYPE_NOT_ALLOWED",
      "Choose an allowed file format.",
    );
    formAssert(
      c.size_bytes <=
        Math.min(f.max_file_size_bytes, this.policy().maxFileSizeBytes),
      "FILE_TOO_LARGE",
      "The file exceeds the size limit.",
    );
    const pending = r.uploads.filter((u) =>
      ["pending", "uploading"].includes(u.state),
    );
    formAssert(
      pending.length < this.policy().maxConcurrentUploadsPerSession,
      "QUOTA_EXCEEDED",
      "Wait for another upload to finish.",
    );
    if (c.target) {
      formAssert(
        active.some(
          (a) =>
            a.attachment_id === c.target?.attachment_id &&
            a.version === c.target.version,
        ),
        "ATTACHMENT_VERSION_CONFLICT",
        "The attachment version changed.",
      );
      formAssert(
        !pending.some(
          (u) => u.target?.attachment_id === c.target?.attachment_id,
        ),
        "UPLOAD_IN_PROGRESS",
        "This file is already being replaced.",
      );
    } else
      formAssert(
        active.length +
          pending.filter((u) => u.item_id === item.id && !u.target).length <
          f.max_count,
        "QUOTA_EXCEEDED",
        "The item already has its maximum number of files.",
      );
    const bytes = Object.values(r.attachments)
      .flat()
      .reduce((sum, a) => sum + a.size_bytes, 0);
    formAssert(
      bytes +
        pending.reduce((sum, u) => sum + u.size_bytes, 0) +
        c.size_bytes <=
        this.policy().maxTotalFileBytesPerForm,
      "QUOTA_EXCEEDED",
      "The form file quota is exhausted.",
    );
    formAssert(
      this.store.storedBytes(r.session_id) +
        pending.reduce((sum, u) => sum + u.size_bytes, 0) +
        c.size_bytes <=
        this.policy().maxTotalFileBytesPerForm * 2,
      "QUOTA_EXCEEDED",
      "The chat's retained file quota is exhausted.",
    );
    formAssert(
      this.store.identityReservedBytes(r.creator_id) + c.size_bytes <=
        this.policy().maxTotalFileBytesPerForm * 2,
      "QUOTA_EXCEEDED",
      "The account's retained file quota is exhausted.",
    );
    const upload: QaFormUpload = {
      id: randomUUID(),
      item_id: item.id,
      name: c.name,
      size_bytes: c.size_bytes,
      state: "pending",
      expires_at: Date.now() + this.policy().uploadIntentTtlSeconds * 1000,
      ...(c.target ? { target: c.target } : {}),
    };
    r.uploads.push(upload);
  }
}
