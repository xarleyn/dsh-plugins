import { compactLocations } from "./normalize.js";
import type {
  QaSourceEvidence,
  QaSourceOrigin,
  QaSourceReference,
} from "./types.js";

const EVIDENCE_STRENGTH: Readonly<Record<QaSourceEvidence, number>> = {
  discovered: 0,
  inherited: 1,
  reported: 2,
  queried: 3,
  read: 4,
  fetched: 4,
};

function originKey(origin: QaSourceOrigin): string {
  return [
    origin.sessionId,
    origin.turn,
    origin.step ?? "",
    origin.toolCallId ?? "",
    origin.agentId ?? "",
    origin.subagentRunId ?? "",
  ].join("\u0000");
}

function mergeOrigins(
  left: readonly QaSourceOrigin[],
  right: readonly QaSourceOrigin[],
): readonly QaSourceOrigin[] {
  const seen = new Set<string>();
  return [...left, ...right].filter((origin) => {
    const key = originKey(origin);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bestText(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (left === undefined || left === "") return right;
  if (right === undefined || right === "") return left;
  return right.length > left.length ? right : left;
}

function mergePair(
  left: QaSourceReference,
  right: QaSourceReference,
  mergeFileRanges: boolean,
): QaSourceReference {
  const stronger =
    EVIDENCE_STRENGTH[right.evidence] > EVIDENCE_STRENGTH[left.evidence]
      ? right
      : left;
  const leftTitleExplicit = left.metadata?.titleExplicit === true;
  const rightTitleExplicit = right.metadata?.titleExplicit === true;
  const uri = bestText(left.uri, right.uri);
  const path = bestText(left.path, right.path);
  const snippet = bestText(left.snippet, right.snippet);
  return {
    ...left,
    kind: stronger.kind,
    title: rightTitleExplicit
      ? right.title
      : leftTitleExplicit
        ? left.title
        : right.score > left.score
          ? right.title
          : (bestText(left.title, right.title) ?? left.title),
    ...(uri === undefined ? {} : { uri }),
    ...(path === undefined ? {} : { path }),
    ...(snippet === undefined ? {} : { snippet }),
    locations: mergeFileRanges
      ? compactLocations([...left.locations, ...right.locations])
      : [
          ...new Map(
            [...left.locations, ...right.locations].map((location) => [
              JSON.stringify(location),
              location,
            ]),
          ).values(),
        ],
    evidence: stronger.evidence,
    origins: mergeOrigins(left.origins, right.origins),
    score: Math.max(left.score, right.score),
    metadata: { ...left.metadata, ...right.metadata },
  };
}

/** Merge by canonical id and rank by score, preserving first-use order on ties. */
export function dedupeAndRankSources(
  sources: readonly QaSourceReference[],
  options: { readonly mergeFileRanges?: boolean } = {},
): readonly QaSourceReference[] {
  const merged = new Map<
    string,
    { source: QaSourceReference; order: number }
  >();
  sources.forEach((source, order) => {
    const previous = merged.get(source.id);
    merged.set(source.id, {
      source:
        previous === undefined
          ? source
          : mergePair(previous.source, source, options.mergeFileRanges ?? true),
      order: previous?.order ?? order,
    });
  });
  return [...merged.values()]
    .sort(
      (left, right) =>
        right.source.score - left.source.score || left.order - right.order,
    )
    .map(({ source }) => source);
}
