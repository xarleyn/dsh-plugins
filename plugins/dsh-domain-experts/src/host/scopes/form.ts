import { z } from "zod";
import {
  SCOPE_PROVIDER_FORM_VERSION,
  type ScopeProviderForm,
  type ScopeProviderFormEdit,
} from "../../types.js";
import {
  displayProviderField,
  parseProviderField,
  readProviderDocument,
} from "../../scope-provider-form.js";
import { DomainExpertsError } from "../errors.js";

const key = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u)
  .refine((value) => value !== "constructor" && value !== "prototype");
const revision = z.number().int().positive();
const formSchema = z.object({
  version: z.literal(SCOPE_PROVIDER_FORM_VERSION),
  revision,
  documentVersion: z.object({ key, current: revision }).nullable(),
  fields: z
    .array(
      z.object({
        key,
        label: z.string().trim().min(1),
        kind: z.enum(["text", "integer", "boolean", "choice"]),
        required: z.boolean(),
        options: z.array(
          z.object({
            value: z
              .string()
              .min(1)
              .refine((value) => value.trim() !== ""),
            label: z.string().trim().min(1),
          }),
        ),
      }),
    )
    .min(1),
});

/** Freeze the wire shape at registration, including a marker for future forms. */
export function scopeProviderForm(
  providerId: string,
  form: ScopeProviderForm,
): ScopeProviderForm {
  function invalid(): never {
    throw new DomainExpertsError(
      "DOMAIN_INVALID",
      `Scope provider "${providerId}" has an invalid form descriptor.`,
    );
  }
  if (
    !revision.safeParse(form.version).success ||
    !revision.safeParse(form.revision).success
  )
    invalid();
  if (form.version !== SCOPE_PROVIDER_FORM_VERSION) {
    return {
      version: form.version,
      revision: form.revision,
      documentVersion: null,
      fields: [],
    };
  }
  const parsed = formSchema.safeParse(form);
  if (!parsed.success) invalid();
  const result = parsed.data;
  const used = new Set(
    result.documentVersion === null ? [] : [result.documentVersion.key],
  );
  for (const field of result.fields) {
    if (
      used.has(field.key) ||
      (field.kind === "choice") !== field.options.length > 0 ||
      new Set(field.options.map(({ value }) => value)).size !==
        field.options.length
    )
      invalid();
    used.add(field.key);
  }
  return result;
}

/** Preserve numeric source tokens in opaque fields, including nested values. */
function parseWithOriginalNumbers(source: string): Record<string, unknown> {
  const runtime = JSON as unknown as {
    rawJSON?: (value: string) => unknown;
    parse(
      text: string,
      reviver: (
        key: string,
        value: unknown,
        context?: { source: string },
      ) => unknown,
    ): unknown;
  };
  const rawJSON = runtime.rawJSON;
  return runtime.parse(source, (_key, value, context) => {
    if (typeof value !== "number") return value;
    if (rawJSON === undefined || context?.source === undefined) {
      throw new DomainExpertsError(
        "PROVIDER_CONFIG_READ_ONLY",
        "This runtime cannot safely preserve numeric configuration fields.",
      );
    }
    return rawJSON(context.source);
  }) as Record<string, unknown>;
}

export function patchScopeProviderDocument(
  form: ScopeProviderForm,
  edit: ScopeProviderFormEdit,
  baseline: string,
  current: string,
): string {
  if (form.revision !== edit.revision || baseline !== current) {
    throw new DomainExpertsError(
      "PROVIDER_CONFIG_STALE",
      `Scope provider "${edit.providerId}" changed. Reopen the domain before editing its configuration.`,
    );
  }
  const document = readProviderDocument(form, current);
  if (!document.ok) {
    throw new DomainExpertsError("PROVIDER_CONFIG_READ_ONLY", document.reason);
  }
  const fields = new Map(form.fields.map((field) => [field.key, field]));
  const updates = new Map<string, string | number | boolean | undefined>();
  for (const { key, value } of edit.fields) {
    const field = fields.get(key);
    if (field === undefined || updates.has(key)) {
      throw new DomainExpertsError(
        "PROVIDER_CONFIG_INVALID",
        "The form contains an unknown or duplicate field.",
      );
    }
    const parsed = parseProviderField(field, value);
    if (!parsed.ok) {
      throw new DomainExpertsError(
        "PROVIDER_CONFIG_INVALID",
        `${field.label}: ${parsed.reason}`,
      );
    }
    updates.set(key, parsed.value);
  }
  for (const field of form.fields) {
    if (!field.required || updates.has(field.key)) continue;
    const text = displayProviderField(field, document.data);
    if (text === undefined || !parseProviderField(field, text).ok) {
      throw new DomainExpertsError(
        "PROVIDER_CONFIG_INVALID",
        `${field.label} requires a valid value.`,
      );
    }
  }
  const next = new Map(
    Object.entries(parseWithOriginalNumbers(current || "{}")),
  );
  for (const [key, value] of updates) {
    if (value === undefined) next.delete(key);
    else next.set(key, value);
  }
  if (form.documentVersion !== null && !next.has(form.documentVersion.key)) {
    next.set(form.documentVersion.key, form.documentVersion.current);
  }
  return JSON.stringify(Object.fromEntries(next));
}
