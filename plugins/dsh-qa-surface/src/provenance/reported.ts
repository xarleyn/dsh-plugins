import { canonicalizeUrl, canonicalizeWorkspacePath } from "./normalize.js";
import type {
  QaReportedSource,
  QaSourceOrigin,
  QaSourceReference,
} from "./types.js";

function fallbackTitle(value: string): string {
  return value.split(/[\\/]/u).at(-1) || value;
}

/** Normalize a source explicitly reported by a delegated provider. */
export function normalizeReportedSource(
  source: QaReportedSource,
  origin: QaSourceOrigin,
  workspaceRoot?: string,
  urlOptions: Parameters<typeof canonicalizeUrl>[1] = {},
): QaSourceReference | null {
  const title = source.title.trim();
  if (title === "") return null;
  if (source.path !== undefined) {
    const path = canonicalizeWorkspacePath(source.path, workspaceRoot);
    if (path === "") return null;
    return {
      id: `file:${path}`,
      kind: source.kind === "code" ? "code" : "file",
      title: title || fallbackTitle(path),
      path,
      ...(source.snippet === undefined ? {} : { snippet: source.snippet }),
      locations: source.locations?.map((location) => ({
        ...location,
        path,
      })) ?? [{ path }],
      evidence: "reported",
      origins: [origin],
      score: 80,
      ...(source.metadata === undefined ? {} : { metadata: source.metadata }),
    };
  }
  if (source.uri !== undefined) {
    const uri = canonicalizeUrl(source.uri, urlOptions);
    if (uri === null) return null;
    return {
      id:
        source.kind === "jira"
          ? `jira:${source.locations?.[0]?.jiraKey ?? uri}`
          : source.kind === "confluence"
            ? `confluence:${source.locations?.[0]?.confluencePageId ?? uri}`
            : `${source.kind}:${uri}`,
      kind: source.kind,
      title,
      uri,
      ...(source.snippet === undefined ? {} : { snippet: source.snippet }),
      locations: source.locations ?? [],
      evidence: "reported",
      origins: [origin],
      score: 80,
      ...(source.metadata === undefined ? {} : { metadata: source.metadata }),
    };
  }
  return null;
}
