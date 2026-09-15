import {
  canonicalizeUrl,
  canonicalizeWorkspacePath,
  unwrapSourceTarget,
} from "./normalize.js";
import type {
  QaReportedSource,
  QaSourceOrigin,
  QaSourceReference,
} from "./types.js";

function fallbackTitle(value: string): string {
  return value.split(/[\\/]/u).at(-1) || value;
}

export interface ReportedSourceOptions {
  /**
   * Whether a reported source must carry an address to be recorded. With
   * `false`, a source the model wrote without a usable path or URL keeps its
   * own type, title and snippet instead of being dropped.
   */
  readonly validate?: boolean;
}

/** Normalize a source explicitly reported by a delegated provider. */
export function normalizeReportedSource(
  source: QaReportedSource,
  origin: QaSourceOrigin,
  workspaceRoot?: string,
  urlOptions: Parameters<typeof canonicalizeUrl>[1] = {},
  options: ReportedSourceOptions = {},
): QaSourceReference | null {
  const validate = options.validate ?? true;
  const rawTitle = source.title.trim();
  if (rawTitle === "" && validate) return null;
  const canonicalPath =
    source.path === undefined
      ? ""
      : canonicalizeWorkspacePath(source.path, workspaceRoot);
  const canonicalUri =
    source.uri === undefined
      ? undefined
      : canonicalizeUrl(source.uri, urlOptions);
  // An address the normalizer empties out is no address at all. A URL it
  // refuses to parse survives verbatim only without validation, so the model's
  // own wording still reaches the list.
  const path = canonicalPath === "" ? undefined : canonicalPath;
  const uri =
    canonicalUri ??
    (validate ? undefined : unwrapSourceTarget(source.uri ?? "") || undefined);
  const title = rawTitle === "" ? fallbackTitle(path ?? uri ?? "") : rawTitle;
  if (title === "") return null;
  if (path !== undefined) {
    return {
      id: `file:${path}`,
      kind: source.kind === "code" ? "code" : "file",
      title,
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
  if (uri !== undefined) {
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
  // Reached only with validation off: the model reported a source it can
  // describe but not address, so the title is the whole identity.
  if (!validate) {
    return {
      id: `reported:${source.kind}:${title}`,
      kind: source.kind,
      title,
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
