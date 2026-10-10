import { canonicalizeUrl } from "./normalize.js";
import type {
  QaSourceReference,
  SourceExtractor,
  SourceExtractorContext,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function records(value: unknown, depth = 0, budget = { remaining: 400 }): UnknownRecord[] {
  if (depth > 4 || budget.remaining-- <= 0) return [];
  if (Array.isArray(value))
    return value.slice(0, 400).flatMap((item) => records(item, depth + 1, budget));
  const item = record(value);
  if (item === undefined) return [];
  return [
    item,
    ...Object.values(item).slice(0, 400).flatMap((child) => records(child, depth + 1, budget)),
  ];
}

function text(item: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

export function contextRecords(context: SourceExtractorContext): UnknownRecord[] {
  const blocks = Array.isArray(context.result) ? context.result : [];
  // Decode only a complete JSON result of a known retrieval tool. Never scan
  // assistant prose, JSON-looking excerpts or arbitrary URLs inside strings.
  const decoded = blocks.slice(0, 8).flatMap((block) => {
    const item = record(block);
    if (item?.type !== "text" || typeof item.text !== "string" || item.text.length > 500_000) return [];
    try { return records(JSON.parse(item.text)); } catch { return []; }
  });
  return [...records(context.presentation), ...records(context.result), ...decoded];
}

type UrlOptions = Parameters<typeof canonicalizeUrl>[1];

export function canonicalUri(
  item: UnknownRecord,
  urlOptions: UrlOptions,
): string | undefined {
  const raw = text(item, "webUrl", "web_url", "browseUrl", "permalink", "html_url", "url", "uri", "self");
  if (raw === undefined) return undefined;
  return canonicalizeUrl(raw, urlOptions) ?? undefined;
}

export function createJiraExtractor(
  urlOptions: UrlOptions = {},
): SourceExtractor {
  return {
    id: "structured-jira",
    matches(context) {
      return context.toolName.toLowerCase().includes("jira");
    },
    extract(context) {
      const seen = new Set<string>();
      return contextRecords(context).flatMap((item): QaSourceReference[] => {
        const rawKey = text(item, "key", "issueKey", "issue_key");
        const key = rawKey?.toUpperCase();
        if (
          key === undefined ||
          !/^[A-Z][A-Z0-9]+-\d+$/u.test(key) ||
          seen.has(key)
        )
          return [];
        seen.add(key);
        const fields = record(item.fields);
        const summary =
          text(item, "summary", "title") ??
          (fields === undefined ? undefined : text(fields, "summary"));
        const uri = canonicalUri(item, urlOptions);
        return [
          {
            id: `jira:${key}`,
            kind: "jira",
            title: summary === undefined ? key : `${key} — ${summary}`,
            ...(uri === undefined ? {} : { uri }),
            locations: [{ jiraKey: key }],
            evidence: "queried",
            origins: [context.origin],
            score: 90,
          },
        ];
      });
    },
  };
}

export function createConfluenceExtractor(
  urlOptions: UrlOptions = {},
): SourceExtractor {
  return {
    id: "structured-confluence",
    matches(context) {
      return context.toolName.toLowerCase().includes("confluence");
    },
    extract(context) {
      const seen = new Set<string>();
      return contextRecords(context).flatMap((item): QaSourceReference[] => {
        const id =
          text(item, "pageId", "page_id", "contentId", "content_id") ??
          (text(item, "type") === "page" ? text(item, "id") : undefined);
        const title = text(item, "title", "name");
        if (id === undefined || title === undefined || seen.has(id)) return [];
        seen.add(id);
        const uri = canonicalUri(item, urlOptions);
        return [
          {
            id: `confluence:${id}`,
            kind: "confluence",
            title,
            ...(uri === undefined ? {} : { uri }),
            locations: [{ confluencePageId: id }],
            evidence: "queried",
            origins: [context.origin],
            score: 90,
            metadata: {
              ...(text(item, "spaceKey", "space_key") === undefined
                ? {}
                : { spaceKey: text(item, "spaceKey", "space_key") ?? "" }),
            },
          },
        ];
      });
    },
  };
}

export function createKnowledgeExtractor(
  urlOptions: UrlOptions = {},
): SourceExtractor {
  return {
    id: "structured-knowledge",
    matches(context) {
      const name = context.toolName.toLowerCase();
      return (
        name.includes("knowledge") || /(?:^|[_:/.-])kb(?:$|[_:/.-])/u.test(name)
      );
    },
    extract(context) {
      const seen = new Set<string>();
      return contextRecords(context).flatMap((item): QaSourceReference[] => {
        const id = text(item, "documentId", "document_id", "docId", "doc_id");
        const title = text(item, "title", "name");
        if (id === undefined || title === undefined || seen.has(id)) return [];
        seen.add(id);
        const backend = text(item, "backend", "provider") ?? context.toolName;
        const uri = canonicalUri(item, urlOptions);
        return [
          {
            id: `knowledge:${backend}:${id}`,
            kind: "knowledge",
            title,
            ...(uri === undefined ? {} : { uri }),
            locations: [],
            evidence: "queried",
            origins: [context.origin],
            score: 85,
            metadata: { backend, documentId: id },
          },
        ];
      });
    },
  };
}

export const jiraExtractor: SourceExtractor = createJiraExtractor();
export const confluenceExtractor: SourceExtractor = createConfluenceExtractor();
export const knowledgeExtractor: SourceExtractor = createKnowledgeExtractor();
