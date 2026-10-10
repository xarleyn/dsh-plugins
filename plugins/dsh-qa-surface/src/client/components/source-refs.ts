import type { QaSource } from "../../types.js";
import { canonicalizeUrl, canonicalizeWorkspacePath } from "../../provenance/normalize.js";

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
  return canonicalizeUrl(value) ?? undefined;
}

/** Separators normalized for comparison, not for display. */
function normalizePath(value: string): string {
  const path = canonicalizeWorkspacePath(value.trim()).replace(/\/+$/u, "");
  return /^(?:[a-zA-Z]:|[/\\]{2})/u.test(value.trim()) ? path.toLowerCase() : path;
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

export function sourceRefsSignature(sources: readonly QaSource[]): string {
  return JSON.stringify(sources);
}

export function buildSourceRefs(sources: readonly QaSource[]): QaSourceRefs {
  if (sources.length === 0) return NO_REFS;
  const byUrl = new Map<string, QaSource>();
  const paths: { readonly normalized: string; readonly windows: boolean; readonly source: QaSource }[] =
    [];
  for (const source of sources) {
    if (source.uri !== undefined) {
      const key = normalizeUrl(source.uri);
      if (key !== undefined) byUrl.set(key, source);
    }
    if (source.path !== undefined) {
      const windows = /^(?:[a-zA-Z]:|[/\\]{2})/u.test(
        typeof source.metadata?.absolutePath === "string" ? source.metadata.absolutePath : source.path);
      const addPath = (value: string) => paths.push({
        normalized: windows ? normalizePath(value).toLowerCase() : normalizePath(value), windows, source });
      addPath(source.path);
      if (typeof source.metadata?.absolutePath === "string")
        addPath(source.metadata.absolutePath);
      const aliases = source.metadata?.aliases;
      if (Array.isArray(aliases)) for (const alias of aliases)
        if (typeof alias === "string") addPath(alias);
    }
  }
  return {
    signature: sourceRefsSignature(sources),
    resolveUrl(url: string): QaSource | undefined {
      const key = normalizeUrl(url);
      return key === undefined ? undefined : byUrl.get(key);
    },
    resolvePath(token: string): QaSource | undefined {
      const normalized = normalizePath(token);
      if (normalized === "") return undefined;
      const unique = (matches: typeof paths): QaSource | undefined => {
        const candidates = new Map(matches.map((entry) => [entry.source.id, entry.source]));
        return candidates.size === 1 ? candidates.values().next().value : undefined;
      };
      const key = (path: typeof paths[number]) => path.windows ? normalized.toLowerCase() : normalized;
      const exact = paths.filter((path) => path.normalized === key(path));
      if (exact.length > 0) return unique(exact);
      if (!normalized.includes("/")) {
        // A bare file name is ambiguous the moment two sources share it.
        const named = paths.filter(
          (path) => basename(path.normalized) === key(path),
        );
        return unique(named);
      }
      // A partial directory path must stay unambiguous the same way.
      const suffix = paths.filter((path) =>
        path.normalized.endsWith(`/${key(path)}`),
      );
      return unique(suffix);
    },
  };
}
