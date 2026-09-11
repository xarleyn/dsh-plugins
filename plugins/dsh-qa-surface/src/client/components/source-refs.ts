import type { QaSource } from "../../types.js";

/**
 * Match layer between assistant text and the canonical turn sources: markdown
 * links resolve by normalized URL, inline-code tokens by file path. A token
 * that matches nothing keeps its plain rendering — the surface never guesses.
 */
export interface QaSourceRefs {
  /** Identity of the source set; memo comparators compare this. */
  readonly signature: string;
  resolveUrl(url: string): QaSource | undefined;
  resolvePath(token: string): QaSource | undefined;
}

/** http(s) URLs only, case-folded authority, hash and trailing slash gone. */
function normalizeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/u, "");
    }
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

/** Separators normalized for comparison, not for display. */
function normalizePath(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

function basename(value: string): string {
  const slash = value.lastIndexOf("/");
  return slash < 0 ? value : value.slice(slash + 1);
}

/** Display name for a file-backed source: the file name alone, case kept. */
export function sourceFileName(source: QaSource): string {
  const normalized = (source.path ?? source.uri ?? source.title)
    .trim()
    .replace(/\\/gu, "/");
  const slash = normalized.lastIndexOf("/");
  const name = slash < 0 ? normalized : normalized.slice(slash + 1);
  return name === "" ? source.title : name;
}

const NO_REFS: QaSourceRefs = {
  signature: "",
  resolveUrl: () => undefined,
  resolvePath: () => undefined,
};

export function buildSourceRefs(sources: readonly QaSource[]): QaSourceRefs {
  if (sources.length === 0) return NO_REFS;
  const byUrl = new Map<string, QaSource>();
  const paths: { readonly normalized: string; readonly source: QaSource }[] =
    [];
  for (const source of sources) {
    if (source.uri !== undefined) {
      const key = normalizeUrl(source.uri);
      if (key !== undefined) byUrl.set(key, source);
    }
    if (source.path !== undefined) {
      paths.push({ normalized: normalizePath(source.path), source });
    }
  }
  return {
    signature: sources.map((source) => source.id).join("|"),
    resolveUrl(url: string): QaSource | undefined {
      const key = normalizeUrl(url);
      return key === undefined ? undefined : byUrl.get(key);
    },
    resolvePath(token: string): QaSource | undefined {
      const normalized = normalizePath(token);
      if (normalized === "") return undefined;
      const exact = paths.find((path) => path.normalized === normalized);
      if (exact !== undefined) return exact.source;
      if (!normalized.includes("/")) {
        // A bare file name is ambiguous the moment two sources share it.
        const named = paths.filter(
          (path) => basename(path.normalized) === normalized,
        );
        return named.length === 1 ? named[0]?.source : undefined;
      }
      // A partial directory path must stay unambiguous the same way.
      const suffix = paths.filter((path) =>
        path.normalized.endsWith(`/${normalized}`),
      );
      return suffix.length === 1 ? suffix[0]?.source : undefined;
    },
  };
}
