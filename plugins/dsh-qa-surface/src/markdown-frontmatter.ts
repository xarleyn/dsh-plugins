import { parseDocument } from "yaml";
import type {
  QaSourceMetadata,
  QaSourceMetadataValue,
} from "./provenance/types.js";

export interface MarkdownFrontmatter {
  readonly body: string;
  /** Physical lines removed, including both fences. */
  readonly offset: number;
  readonly fields: QaSourceMetadata;
}

/** Only a complete, bounded YAML mapping at the start earns a metadata card. */
export function readFrontmatter(text: string): MarkdownFrontmatter | undefined {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  if (lines[0]?.replace(/^\uFEFF/u, "").trimEnd() !== "---") return undefined;
  const end = lines.findIndex(
    (line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line),
  );
  if (end < 1 || end > 512) return undefined;
  const header = lines.slice(1, end).join("\n");
  if (header.length > 65_536) return undefined;
  try {
    const doc = parseDocument(header, { schema: "core", uniqueKeys: true });
    if (doc.errors.length > 0) return undefined;
    // Do not expand aliases or accept custom executable YAML types.
    const fields: unknown = doc.toJS({ maxAliasCount: 0 });
    if (fields === null || typeof fields !== "object" || Array.isArray(fields))
      return undefined;
    return {
      body: lines.slice(end + 1).join("\n"),
      offset: end + 1,
      fields: jsonValue(fields) as QaSourceMetadata,
    };
  } catch {
    return undefined;
  }
}

function jsonValue(value: unknown, depth = 0): QaSourceMetadataValue {
  if (depth > 12) return "…";
  if (typeof value === "string" || typeof value === "boolean" || value === null)
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value))
    return value.map((item) => jsonValue(item, depth + 1));
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonValue(item, depth + 1),
      ]),
    );
  return null;
}
