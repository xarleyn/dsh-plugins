import type { QaSourceLocation } from "./types.js";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
]);

/** Strip model-added XML-like wrappers without interpreting arbitrary prose. */
export function unwrapSourceTarget(value: string): string {
  return value.replace(/<\/?[a-zA-Z][^>]*>/gu, "").trim();
}

/** Canonical HTTP(S) identity while retaining business-relevant parameters. */
export function canonicalizeUrl(
  value: string,
  options: {
    readonly normalize?: boolean;
    readonly stripTrackingParams?: boolean;
  } = {},
): string | null {
  try {
    const url = new URL(unwrapSourceTarget(value));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const normalize = options.normalize ?? true;
    const stripTrackingParams = options.stripTrackingParams ?? true;
    if (normalize) url.hash = "";
    url.username = "";
    url.password = "";
    if (stripTrackingParams) {
      for (const key of [...url.searchParams.keys()]) {
        if (
          key.toLowerCase().startsWith("utm_") ||
          TRACKING_PARAMETERS.has(key.toLowerCase())
        ) {
          url.searchParams.delete(key);
        }
      }
    }
    if (normalize) {
      url.searchParams.sort();
      if (url.pathname !== "/")
        url.pathname = url.pathname.replace(/\/+$/u, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

function lexicalPath(value: string): string {
  const normalized = unwrapSourceTarget(value).replaceAll("\\", "/");
  const drive = /^[a-zA-Z]:/u.exec(normalized)?.[0];
  const absolute = normalized.startsWith("/") || drive !== undefined;
  const body =
    drive === undefined ? normalized : normalized.slice(drive.length);
  const parts: string[] = [];
  for (const part of body.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts.at(-1) !== "..") parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  const prefix =
    drive === undefined ? (absolute ? "/" : "") : `${drive[0]?.toLowerCase()}:`;
  return `${prefix}${prefix !== "" && parts.length > 0 ? "/" : ""}${parts.join("/")}`;
}

/** Normalize separators and, when possible, make a path workspace-relative. */
export function canonicalizeWorkspacePath(
  value: string,
  workspaceRoot?: string,
): string {
  const path = lexicalPath(value);
  if (workspaceRoot === undefined || workspaceRoot.trim() === "") return path;
  const root = lexicalPath(workspaceRoot).replace(/\/$/u, "");
  const caseInsensitive = /^[a-z]:/iu.test(root);
  const comparedPath = caseInsensitive ? path.toLowerCase() : path;
  const comparedRoot = caseInsensitive ? root.toLowerCase() : root;
  if (comparedPath === comparedRoot) return ".";
  if (comparedPath.startsWith(`${comparedRoot}/`))
    return path.slice(root.length + 1);
  return path;
}

function locationKey(location: QaSourceLocation): string {
  return [
    location.path ?? "",
    location.anchor ?? "",
    location.jiraKey ?? "",
    location.confluencePageId ?? "",
  ].join("\u0000");
}

/** Union exact anchors and compact overlapping or adjacent ranges. */
export function compactLocations(
  locations: readonly QaSourceLocation[],
): readonly QaSourceLocation[] {
  const groups = new Map<string, QaSourceLocation[]>();
  for (const location of locations) {
    const key = locationKey(location);
    const group = groups.get(key) ?? [];
    group.push(location);
    groups.set(key, group);
  }
  const output: QaSourceLocation[] = [];
  for (const group of groups.values()) {
    const ranged = group
      .flatMap((item) => {
        const lineStart = item.lineStart ?? item.lineEnd;
        const lineEnd = item.lineEnd ?? item.lineStart;
        return lineStart === undefined || lineEnd === undefined
          ? []
          : [{ ...item, lineStart, lineEnd }];
      })
      .sort((left, right) => left.lineStart - right.lineStart);
    const plain = group.find(
      (item) => item.lineStart === undefined && item.lineEnd === undefined,
    );
    if (plain !== undefined && ranged.length === 0) output.push(plain);
    for (const range of ranged) {
      const previous = output.at(-1);
      if (
        previous !== undefined &&
        locationKey(previous) === locationKey(range) &&
        previous.lineEnd !== undefined &&
        range.lineStart <= previous.lineEnd + 1
      ) {
        output[output.length - 1] = {
          ...previous,
          lineEnd: Math.max(previous.lineEnd, range.lineEnd),
        };
      } else {
        output.push(range);
      }
    }
  }
  return output;
}
