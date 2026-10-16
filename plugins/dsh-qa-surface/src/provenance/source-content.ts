/** Text retained from a single addressed tool result, never from model prose. */
export const MAX_SOURCE_CONTENT = 32_000;

type RecordValue = Record<string, unknown>;
interface TextBudget {
  remaining: number;
  characters: number;
  partial: boolean;
}

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

/** Known rich-text shapes only; do not serialize arbitrary provider fields. */
function richText(value: unknown, depth = 0, budget: TextBudget): string {
  if (depth > 16 || budget.remaining-- <= 0 || budget.characters <= 0) {
    budget.partial = true;
    return "";
  }
  if (typeof value === "string") {
    if (value.length > budget.characters) budget.partial = true;
    const text = value.slice(0, budget.characters);
    budget.characters -= text.length;
    return text;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) budget.partial = true;
    return value
      .slice(0, 1_000)
      .map((child) => richText(child, depth + 1, budget))
      .join("");
  }
  const item = record(value);
  if (item === undefined) return "";
  if (typeof item.text === "string")
    return richText(item.text, depth + 1, budget);
  if (item.type === "hardBreak") return "\n";
  if (Array.isArray(item.content)) {
    const text = richText(item.content, depth + 1, budget);
    return ["paragraph", "heading", "listItem", "codeBlock"].includes(
      String(item.type),
    )
      ? `${text}\n`
      : text;
  }
  if (typeof item.value === "string") {
    if (item.value.length > budget.characters) budget.partial = true;
    const value = item.value.slice(0, budget.characters);
    budget.characters -= value.length;
    // Confluence storage is kept as readable text, not executable HTML.
    return value
      .replace(/<\/(?:p|div|h[1-6]|li|tr)>|<br\s*\/?\s*>/giu, "\n")
      .replace(/<[^>]*>/gu, "")
      .replace(/&nbsp;/gu, " ")
      .replace(/&lt;/gu, "<")
      .replace(/&gt;/gu, ">")
      .replace(/&amp;/gu, "&");
  }
  for (const key of ["storage", "view", "export_view"])
    if (item[key] !== undefined) return richText(item[key], depth + 1, budget);
  return "";
}

export function retainedSourceContent(
  value: string | undefined,
  partial = false,
) {
  const text = value?.trim();
  if (!text) return {};
  return {
    content: text.slice(0, MAX_SOURCE_CONTENT),
    contentTruncated: partial || text.length > MAX_SOURCE_CONTENT,
  };
}

export function structuredSourceContent(item: RecordValue) {
  const fields = record(item.fields);
  const untrusted = record(item.untrustedContent);
  const candidates = [
    item.description,
    fields?.description,
    item.body,
    item.content,
    item.text,
    item.DESCRIPTION,
    untrusted?.text,
  ];
  for (const candidate of candidates) {
    const budget: TextBudget = {
      remaining: 4_000,
      characters: MAX_SOURCE_CONTENT,
      partial: false,
    };
    const value = richText(candidate, 0, budget).trim();
    if (value)
      return retainedSourceContent(
        value,
        budget.partial ||
          item.truncated === true ||
          untrusted?.truncated === true,
      );
  }
  const excerpt =
    typeof item.excerpt === "string"
      ? item.excerpt
      : typeof item.snippet === "string"
        ? item.snippet
        : typeof untrusted?.excerpt === "string"
          ? untrusted.excerpt
          : undefined;
  return retainedSourceContent(excerpt, true);
}
