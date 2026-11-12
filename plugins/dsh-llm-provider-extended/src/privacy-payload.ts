import { PrivacyError, type PrivacyFilter } from "./privacy-rules.js";

const textFields = new Set([
  "text",
  "content",
  "system",
  "input",
  "output",
  "instructions",
  "thinking",
  "reasoning_content",
  "description",
  "title",
  "stop",
  "stop_sequences",
]);
const moneyField =
  /^(?:amount|price|cost|salary|balance|total[_-]?amount|сумма|стоимость|зарплата|цена)$/iu;
const clientField =
  /^(?:customer|client|(?:customer|client|full)[ _-]?name|клиент|фио|имя[ _-]?клиента)$/iu;

/**
 * Read the finished SDK payload, after JSON escaping, tool conversion and sampling defaults.
 * In data we can replace values. A sensitive protocol identifier or JSON key cannot be
 * renamed without changing how the provider or a tool interprets the request.
 */
export function maskPayload(payload: unknown, filter: PrivacyFilter): unknown {
  let nodes = 0;
  let remaining = 4_000_000;
  let learning = true;
  const refuse = (): never => {
    throw new PrivacyError(
      "Request masking found sensitive data in a protocol identifier or JSON key",
    );
  };
  function visit(
    value: unknown,
    field: string,
    data: boolean,
    depth: number,
    conversationText = false,
  ): unknown {
    if (++nodes > 100000 || depth > 80)
      throw new PrivacyError(
        "Request masking exceeded its structured data limit",
      );
    if (typeof value === "string") {
      remaining -= value.length;
      if (remaining < 0) throw new PrivacyError("Privacy text limit exceeded");
      if (data && clientField.test(field) && value.trim()) {
        if (!learning) return filter.alias("CLIENT", value);
        filter.learnName(value);
        return value;
      }
      const readable = data || textFields.has(field);
      // Some protocols serialize tool arguments and tool outputs as JSON strings.
      // Inspect decoded values (including escaped Unicode) and numeric amount fields.
      if (readable || field === "arguments") {
        const trimmed = value.trimStart();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(value);
          } catch {
            /* ordinary prose */
          }
          if (parsed !== undefined) {
            const safe = visit(parsed, "", true, depth + 1, conversationText);
            // Re-encode inspected JSON even if its decoded values were unchanged.
            // Raw input may contain an earlier, shadowed key or escaped text.
            if (!learning) return JSON.stringify(safe);
          }
        }
      }
      if (learning) {
        if (data && moneyField.test(field)) filter.learnAmount(value);
        if (readable) filter.learnText(value);
        return value;
      }
      if (data && moneyField.test(field) && value.trim())
        return filter.alias("AMOUNT", value);
      const safe = filter.text(value, conversationText && readable);
      if (safe !== value && !readable && field !== "arguments") refuse();
      return safe;
    }
    if (typeof value === "number") {
      if (learning) {
        if (data && moneyField.test(field)) filter.learnAmount(String(value));
        return value;
      }
      if (data && moneyField.test(field))
        return filter.alias("AMOUNT", String(value));
      if (
        data &&
        (!Number.isFinite(value) ||
          (Number.isInteger(value) && !Number.isSafeInteger(value)))
      )
        throw new PrivacyError(
          "Request masking cannot preserve this JSON number. Encode large identifiers as strings.",
        );
      const safe = filter.text(String(value), conversationText && data);
      if (safe === String(value)) return value;
      if (!data) refuse();
      return safe;
    }
    if (Array.isArray(value)) {
      const next = value.map((item) =>
        visit(item, field, data, depth + 1, conversationText),
      );
      return next.some((item, i) => item !== value[i]) ? next : value;
    }
    if (value === null || typeof value !== "object") return value;
    const entries = Object.entries(value);
    const next = entries.map(([key, item]) => {
      if (!learning && filter.text(key) !== key) refuse();
      const toolInput =
        key === "input" && (value as { type?: string }).type === "tool_use";
      const role = (value as { role?: string }).role;
      const messageContent =
        key === "content" &&
        (role === "assistant" || role === "user" || role === "tool");
      return [
        key,
        visit(
          item,
          key,
          data || toolInput,
          depth + 1,
          conversationText || messageContent,
        ),
      ] as const;
    });
    return next.some((pair, i) => pair[1] !== entries[i]![1])
      ? Object.fromEntries(next)
      : value;
  }
  // A name may first be labelled late in the history or in a tool result.
  visit(payload, "", false, 0);
  filter.useLearnedNames();
  learning = false;
  nodes = 0;
  remaining = 4_000_000;
  return visit(payload, "", false, 0);
}
