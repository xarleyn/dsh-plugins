import { canonicalizeUrl, canonicalizeWorkspacePath } from "./normalize.js";
import type {
  QaSourceKind,
  QaSourceReference,
  SourceExtractor,
  SourceExtractorContext,
} from "./types.js";
import {
  createConfluenceExtractor,
  createJiraExtractor,
  createKnowledgeExtractor,
} from "./connectors.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function parsedArgs(value: unknown): UnknownRecord {
  if (typeof value !== "string") return record(value) ?? {};
  try {
    return record(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function presentationRecord(value: unknown): UnknownRecord | undefined {
  const direct = record(value);
  if (direct === undefined) return undefined;
  if (
    typeof direct.path === "string" ||
    typeof direct.url === "string" ||
    typeof direct.shape === "string" ||
    Array.isArray(direct.lines) ||
    Array.isArray(direct.sources) ||
    Array.isArray(direct.files)
  ) {
    return direct;
  }
  for (const key of ["presentation", "presentationMeta", "result", "data"]) {
    const nested = record(direct[key]);
    if (nested !== undefined) return nested;
  }
  return direct;
}

function sourceTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/u, "");
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "php",
  "py",
  "rb",
  "rs",
  "scala",
  "sh",
  "sql",
  "swift",
  "ts",
  "tsx",
  "vue",
]);

function fileKind(path: string): QaSourceKind {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return extension !== undefined && CODE_EXTENSIONS.has(extension)
    ? "code"
    : "file";
}

function basename(path: string): string {
  return path.split("/").at(-1) || path;
}

function firstText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!Array.isArray(result)) return undefined;
  for (const block of result) {
    const item = record(block);
    if (item?.type === "text" && typeof item.text === "string")
      return item.text;
  }
  return undefined;
}

function snippet(value: string | undefined): string | undefined {
  const line = value
    ?.split(/\r?\n/u)
    .find((part) => part.trim() !== "")
    ?.trim();
  if (line === undefined || line === "") return undefined;
  const compact = line.replace(/\s+/gu, " ");
  return compact.length <= 240 ? compact : `${compact.slice(0, 239)}…`;
}

export const readFileExtractor: SourceExtractor = {
  id: "dsh-read-file",
  matches(context) {
    const meta = presentationRecord(context.presentation);
    return (
      context.toolName === "read" ||
      context.toolName === "read_file" ||
      (typeof meta?.path === "string" && Array.isArray(meta.lines))
    );
  },
  extract(context) {
    const args = parsedArgs(context.args);
    const meta = presentationRecord(context.presentation);
    const rawPath =
      typeof meta?.path === "string"
        ? meta.path
        : typeof args.file_path === "string"
          ? args.file_path
          : typeof args.path === "string"
            ? args.path
            : undefined;
    if (rawPath === undefined || rawPath.trim() === "") return [];
    const path = canonicalizeWorkspacePath(rawPath, context.workspaceRoot);
    const lines = Array.isArray(meta?.lines)
      ? meta.lines
          .map(record)
          .filter((line): line is UnknownRecord => line !== undefined)
      : [];
    const numbers = lines
      .map((line) => line.number)
      .filter(
        (number): number is number =>
          Number.isSafeInteger(number) && Number(number) > 0,
      );
    const lineStart = numbers.length > 0 ? Math.min(...numbers) : undefined;
    const lineEnd = numbers.length > 0 ? Math.max(...numbers) : undefined;
    const sourceSnippet = snippet(
      lines.length > 0
        ? lines
            .map((line) => (typeof line.text === "string" ? line.text : ""))
            .join("\n")
        : firstText(context.result),
    );
    return [
      {
        id: `file:${path}`,
        kind: fileKind(path),
        title: basename(path),
        path,
        ...(sourceSnippet === undefined ? {} : { snippet: sourceSnippet }),
        locations: [
          {
            path,
            ...(lineStart === undefined ? {} : { lineStart }),
            ...(lineEnd === undefined ? {} : { lineEnd }),
          },
        ],
        evidence: "read",
        origins: [context.origin],
        score: 100,
        metadata: {
          ...(typeof meta?.totalLines === "number"
            ? { totalLines: meta.totalLines }
            : {}),
          ...(typeof meta?.lang === "string" ? { lang: meta.lang } : {}),
        },
      },
    ];
  },
};

function webSources(meta: UnknownRecord | undefined): UnknownRecord[] {
  return Array.isArray(meta?.sources)
    ? meta.sources
        .map(record)
        .filter((item): item is UnknownRecord => item !== undefined)
    : [];
}

export function createWebSearchExtractor(
  maxPromotedPerSearch = 5,
  urlOptions: Parameters<typeof canonicalizeUrl>[1] = {},
): SourceExtractor {
  return {
    id: "dsh-web-search",
    matches(context) {
      const meta = presentationRecord(context.presentation);
      return context.toolName === "web_search" || webSources(meta).length > 0;
    },
    extract(context) {
      const meta = presentationRecord(context.presentation);
      return webSources(meta).flatMap((item, index): QaSourceReference[] => {
        if (typeof item.url !== "string") return [];
        const uri = canonicalizeUrl(item.url, urlOptions);
        if (uri === null) return [];
        const promoted = index < maxPromotedPerSearch;
        const explicitTitle =
          typeof item.title === "string" && item.title.trim() !== ""
            ? item.title.trim()
            : undefined;
        const titleExplicit = explicitTitle !== undefined;
        const sourceSnippet = snippet(
          typeof item.snippet === "string" ? item.snippet : undefined,
        );
        return [
          {
            id: `web:${uri}`,
            kind: "web",
            title: explicitTitle ?? sourceTitleFromUrl(uri),
            uri,
            ...(sourceSnippet === undefined ? {} : { snippet: sourceSnippet }),
            locations: [],
            evidence: promoted ? "queried" : "discovered",
            origins: [context.origin],
            score: promoted ? 55 : 20,
            metadata: {
              searchResult: true,
              titleExplicit,
              ...(typeof item.publishedAt === "string"
                ? { publishedAt: item.publishedAt }
                : {}),
            },
          },
        ];
      });
    },
  };
}

export function createWebFetchExtractor(
  urlOptions: Parameters<typeof canonicalizeUrl>[1] = {},
): SourceExtractor {
  return {
    id: "dsh-web-fetch",
    matches(context) {
      const meta = presentationRecord(context.presentation);
      return (
        context.toolName === "web_fetch" ||
        (typeof meta?.url === "string" && typeof meta.statusCode === "number")
      );
    },
    extract(context) {
      const args = parsedArgs(context.args);
      const meta = presentationRecord(context.presentation);
      const rawUrl =
        typeof meta?.url === "string"
          ? meta.url
          : typeof args.url === "string"
            ? args.url
            : undefined;
      const uri =
        rawUrl === undefined ? null : canonicalizeUrl(rawUrl, urlOptions);
      if (uri === null) return [];
      const explicitTitle =
        typeof meta?.title === "string" && meta.title.trim() !== ""
          ? meta.title.trim()
          : undefined;
      const titleExplicit = explicitTitle !== undefined;
      const sourceSnippet = snippet(firstText(context.result));
      return [
        {
          id: `web:${uri}`,
          kind: "web",
          title: explicitTitle ?? sourceTitleFromUrl(uri),
          uri,
          ...(sourceSnippet === undefined ? {} : { snippet: sourceSnippet }),
          locations: [],
          evidence: "fetched",
          origins: [context.origin],
          score: 100,
          metadata: {
            titleExplicit,
            ...(typeof meta?.statusCode === "number"
              ? { statusCode: meta.statusCode }
              : {}),
            ...(typeof meta?.truncated === "boolean"
              ? { truncated: meta.truncated }
              : {}),
          },
        },
      ];
    },
  };
}

export const webFetchExtractor: SourceExtractor = createWebFetchExtractor();

export const fileSearchExtractor: SourceExtractor = {
  id: "dsh-file-search",
  matches(context) {
    const meta = presentationRecord(context.presentation);
    return meta?.shape === "matches" && Array.isArray(meta.files);
  },
  extract(context) {
    const meta = presentationRecord(context.presentation);
    if (!Array.isArray(meta?.files)) return [];
    return meta.files.flatMap((candidate): QaSourceReference[] => {
      const file = record(candidate);
      if (typeof file?.path !== "string") return [];
      const path = canonicalizeWorkspacePath(file.path, context.workspaceRoot);
      const matches = Array.isArray(file.matches)
        ? file.matches
            .map(record)
            .filter((item): item is UnknownRecord => item !== undefined)
        : [];
      const numbers = matches
        .map((item) => item.lineNumber)
        .filter(
          (number): number is number =>
            Number.isSafeInteger(number) && Number(number) > 0,
        );
      const sourceSnippet = snippet(
        matches.find((item) => typeof item.line === "string")?.line as
          string | undefined,
      );
      return [
        {
          id: `file:${path}`,
          kind: fileKind(path),
          title: basename(path),
          path,
          ...(sourceSnippet === undefined ? {} : { snippet: sourceSnippet }),
          locations: numbers.map((lineStart) => ({
            path,
            lineStart,
            lineEnd: lineStart,
          })),
          evidence: "discovered",
          origins: [context.origin],
          score: 30,
          metadata: { searchMatch: true },
        },
      ];
    });
  },
};

export class SourceExtractorRegistry {
  private readonly extractors: SourceExtractor[] = [];

  register(extractor: SourceExtractor): () => void {
    this.extractors.push(extractor);
    return () => {
      const index = this.extractors.indexOf(extractor);
      if (index !== -1) this.extractors.splice(index, 1);
    };
  }

  extract(context: SourceExtractorContext): readonly QaSourceReference[] {
    return this.extractors.flatMap((extractor) =>
      extractor.matches(context) ? [...extractor.extract(context)] : [],
    );
  }
}

export function createDefaultSourceExtractorRegistry(
  maxPromotedPerSearch = 5,
  urlOptions: Parameters<typeof canonicalizeUrl>[1] = {},
): SourceExtractorRegistry {
  const registry = new SourceExtractorRegistry();
  // Strong consumers go first; dedupe promotes them over discovery candidates.
  registry.register(readFileExtractor);
  registry.register(createWebFetchExtractor(urlOptions));
  registry.register(createWebSearchExtractor(maxPromotedPerSearch, urlOptions));
  registry.register(fileSearchExtractor);
  registry.register(createJiraExtractor(urlOptions));
  registry.register(createConfluenceExtractor(urlOptions));
  registry.register(createKnowledgeExtractor(urlOptions));
  return registry;
}
