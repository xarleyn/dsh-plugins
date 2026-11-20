import {
  SCOPE_PROVIDER_FORM_VERSION,
  type ScopeProviderForm,
  type ScopeProviderFormField,
} from "./types.js";

type ProviderDocument =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

export function readProviderDocument(
  form: ScopeProviderForm,
  source: string,
): ProviderDocument {
  if (form.version !== SCOPE_PROVIDER_FORM_VERSION) {
    return {
      ok: false,
      reason: "This Host does not support the provider's form version.",
    };
  }
  let data: unknown;
  try {
    data = source === "" ? {} : JSON.parse(source);
  } catch {
    return { ok: false, reason: "The saved configuration is not valid JSON." };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      reason: "The saved configuration is not a JSON object.",
    };
  }
  const document = data as Record<string, unknown>;
  const version = form.documentVersion;
  if (
    version !== null &&
    Object.hasOwn(document, version.key) &&
    document[version.key] !== version.current
  ) {
    return {
      ok: false,
      reason:
        "The provider's saved configuration version is unsupported by this form.",
    };
  }
  return { ok: true, data: document };
}

type FieldValue =
  | { readonly ok: true; readonly value: string | number | boolean | undefined }
  | { readonly ok: false; readonly reason: string };

export function parseProviderField(
  field: ScopeProviderFormField,
  text: string,
): FieldValue {
  if (text.trim() === "") {
    return field.required
      ? { ok: false, reason: "A value is required." }
      : { ok: true, value: undefined };
  }
  switch (field.kind) {
    case "text":
      return { ok: true, value: text };
    case "integer": {
      const value = Number(text);
      return /^-?\d+$/u.test(text) && Number.isSafeInteger(value)
        ? { ok: true, value }
        : { ok: false, reason: "Enter a whole number." };
    }
    case "boolean":
      return text === "true" || text === "false"
        ? { ok: true, value: text === "true" }
        : { ok: false, reason: "Select Yes or No." };
    case "choice":
      return field.options.some(({ value }) => value === text)
        ? { ok: true, value: text }
        : { ok: false, reason: "Select one of the available values." };
  }
}

/** Undefined flags a stored value the current field cannot represent. */
export function displayProviderField(
  field: ScopeProviderFormField,
  document: Record<string, unknown>,
): string | undefined {
  if (!Object.hasOwn(document, field.key)) return "";
  const value = document[field.key];
  const text =
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
      ? String(value)
      : "";
  const parsed = parseProviderField(field, text);
  return parsed.ok &&
    (Object.is(parsed.value, value) || (value === "" && field.kind === "text"))
    ? text
    : undefined;
}
