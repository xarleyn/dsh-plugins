import { z } from "zod";
import { formAssert } from "./errors.js";
import { formSchemaError, formSchemaIssues } from "./schema-errors.js";
import type { QaFormPolicy, QaFormSchema, QaFormSchemaIssue } from "./types.js";

export const DEFAULT_FORM_POLICY: Readonly<QaFormPolicy> = Object.freeze({
  enabled: false,
  maxSteps: 20,
  maxItemsPerForm: 100,
  maxOptionsPerItem: 50,
  maxSchemaBytes: 131072,
  maxTextLength: 10000,
  maxTotalAnswerBytes: 32768,
  maxFilesPerItem: 10,
  maxFileSizeBytes: 52428800,
  maxTotalFileBytesPerForm: 262144000,
  maxConcurrentUploadsPerSession: 2,
  uploadIntentTtlSeconds: 900,
  allowedExtensions: Object.freeze([
    ".pdf",
    ".docx",
    ".xlsx",
    ".csv",
    ".txt",
    ".png",
    ".jpg",
    ".jpeg",
  ]),
});
const id = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/u)
  .refine((v) => !["constructor", "prototype", "__proto__"].includes(v));
const label = z.string().trim().min(1).max(2000);
const integer = z.number().int().nonnegative();
const option = z
  .object({
    value: id,
    label,
    description: label.optional(),
    recommended: z.boolean().optional(),
  })
  .strict();
const answer = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      required: z.boolean(),
      placeholder: label.optional(),
      min_length: integer.optional(),
      max_length: integer.positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("textarea"),
      required: z.boolean(),
      placeholder: label.optional(),
      min_length: integer.optional(),
      max_length: integer.positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("single_select"),
      required: z.boolean(),
      options: z.array(option).min(1),
      allow_other: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("multi_select"),
      required: z.boolean(),
      options: z.array(option).min(1),
      allow_other: z.boolean().optional(),
      min_selected: integer.optional(),
      max_selected: integer.positive().optional(),
    })
    .strict(),
]);
const fileFields = {
  max_count: integer.positive(),
  accept: z.array(z.string().regex(/^\.[a-z0-9]+$/u)).min(1),
  max_file_size_bytes: integer.positive(),
};
const files = z.discriminatedUnion("requirement", [
  z.object({ requirement: z.literal("none") }).strict(),
  z
    .object({
      requirement: z.literal("required"),
      min_count: integer.positive(),
      ...fileFields,
    })
    .strict(),
  z.object({ requirement: z.literal("optional"), ...fileFields }).strict(),
]);
export const formSchemaParser = z
  .object({
    schema_version: z.literal(1),
    title: label,
    description: label.optional(),
    submit_label: label.optional(),
    steps: z
      .array(
        z
          .object({
            id,
            title: label,
            description: label.optional(),
            items: z
              .array(
                z
                  .object({
                    id,
                    title: label,
                    description: label.optional(),
                    answer: answer.optional(),
                    files,
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** Shared by server and browser. No Node APIs or browser-supplied readiness. */
export function parseFormSchema(
  input: unknown,
  policy: Readonly<QaFormPolicy>,
): QaFormSchema {
  const parsed = formSchemaParser.safeParse(input);
  if (!parsed.success)
    throw formSchemaError(formSchemaIssues(parsed.error.issues));
  const schema = parsed.data;
  const issues: QaFormSchemaIssue[] = [];
  const check = (ok: unknown, path: string, message: string) => {
    if (!ok) issues.push({ path, code: "policy_or_conflict", message });
  };
  check(
    new TextEncoder().encode(JSON.stringify(schema)).length <=
      policy.maxSchemaBytes,
    "form",
    `Schema must fit within ${policy.maxSchemaBytes} bytes.`,
  );
  check(
    schema.steps.length <= policy.maxSteps,
    "form.steps",
    `Use at most ${policy.maxSteps} steps.`,
  );
  const stepIds = new Set<string>(),
    itemIds = new Set<string>();
  for (const [stepIndex, step] of schema.steps.entries()) {
    const stepPath = `form.steps[${stepIndex}]`;
    check(!stepIds.has(step.id), `${stepPath}.id`, "Step IDs must be unique.");
    stepIds.add(step.id);
    for (const [itemIndex, item] of step.items.entries()) {
      const itemPath = `${stepPath}.items[${itemIndex}]`;
      check(
        !itemIds.has(item.id),
        `${itemPath}.id`,
        "Item IDs must be unique across the form.",
      );
      itemIds.add(item.id);
      check(
        item.answer !== undefined || item.files.requirement !== "none",
        itemPath,
        "Provide an answer specification or a non-none file requirement. File-only items do not need answer.",
      );
      const a = item.answer;
      if (a?.type === "text" || a?.type === "textarea") {
        check(
          (a.max_length ?? policy.maxTextLength) <= policy.maxTextLength,
          `${itemPath}.answer.max_length`,
          `Must not exceed ${policy.maxTextLength}.`,
        );
        check(
          (a.min_length ?? 0) <= (a.max_length ?? policy.maxTextLength),
          `${itemPath}.answer.min_length`,
          "Must not exceed max_length or the server text limit.",
        );
      } else if (a !== undefined) {
        check(
          a.options.length <= policy.maxOptionsPerItem,
          `${itemPath}.answer.options`,
          `Use at most ${policy.maxOptionsPerItem} options.`,
        );
        check(
          new Set(a.options.map((o) => o.value)).size === a.options.length,
          `${itemPath}.answer.options`,
          "Option values must be unique.",
        );
        if (a.type === "multi_select") {
          const maximum =
            a.max_selected ?? a.options.length + (a.allow_other ? 1 : 0);
          check(
            (a.min_selected ?? 0) <= maximum &&
              maximum <= a.options.length + (a.allow_other ? 1 : 0),
            `${itemPath}.answer.max_selected`,
            "Selection bounds must be ordered and fit the options plus one allowed custom choice.",
          );
        }
      }
      const f = item.files;
      if (f.requirement !== "none") {
        check(
          f.max_count <= policy.maxFilesPerItem,
          `${itemPath}.files.max_count`,
          `Must not exceed ${policy.maxFilesPerItem}.`,
        );
        check(
          f.max_file_size_bytes <= policy.maxFileSizeBytes,
          `${itemPath}.files.max_file_size_bytes`,
          `Must not exceed ${policy.maxFileSizeBytes} bytes.`,
        );
        check(
          f.accept.every((ext) => policy.allowedExtensions.includes(ext)) &&
            new Set(f.accept).size === f.accept.length,
          `${itemPath}.files.accept`,
          `Use unique allowed extensions: ${policy.allowedExtensions.join(", ")}.`,
        );
        if (f.requirement === "required")
          check(
            f.min_count <= f.max_count,
            `${itemPath}.files.min_count`,
            "Must not exceed max_count.",
          );
      }
    }
  }
  check(
    itemIds.size <= policy.maxItemsPerForm,
    "form.steps",
    `Use at most ${policy.maxItemsPerForm} items across all steps.`,
  );
  if (issues.length) throw formSchemaError(issues);
  return schema;
}

export function resolveFormPolicy(
  input: Partial<QaFormPolicy> = {},
): QaFormPolicy {
  const policy = { ...DEFAULT_FORM_POLICY, ...input };
  for (const [key, value] of Object.entries(policy)) {
    if (key === "enabled" || key === "allowedExtensions") continue;
    formAssert(
      typeof value === "number" && Number.isSafeInteger(value) && value > 0,
      "INVALID_SCHEMA",
      `forms.${key} must be a positive integer.`,
    );
  }
  formAssert(
    typeof policy.enabled === "boolean" &&
      Array.isArray(policy.allowedExtensions) &&
      policy.allowedExtensions.length > 0 &&
      policy.allowedExtensions.every((ext) =>
        DEFAULT_FORM_POLICY.allowedExtensions.includes(ext),
      ),
    "INVALID_SCHEMA",
    "Unsupported form file policy.",
  );
  return policy;
}
