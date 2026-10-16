import { canonicalUri, contextRecords } from "./connectors.js";
import { structuredSourceContent } from "./source-content.js";
import { dedupeAndRankSources } from "./dedupe.js";
import type { SourceExtractor } from "./types.js";
import type { canonicalizeUrl } from "./normalize.js";

const PROVIDERS = /^(bitrix24|gitlab|teamcity|testit|weblate)_/u;

/** Successful provider retrievals with explicit addresses or object identity. */
export function integrationExtractor(
  options: Parameters<typeof canonicalizeUrl>[1] = {},
): SourceExtractor {
  return {
    id: "integration-retrieval",
    matches: (context) => PROVIDERS.test(context.toolName),
    extract(context) {
      const provider = PROVIDERS.exec(context.toolName)?.[1];
      if (provider === undefined) return [];
      return dedupeAndRankSources(
        contextRecords(context)
          .slice(0, 200)
          .flatMap((item) => {
            const uri = canonicalUri(item, options);
            const title = [
              item.title,
              item.TITLE,
              item.summary,
              item.name,
              item.NAME,
              item.path,
              item.filename,
              item.comment,
              item.number,
            ].find(
              (value): value is string =>
                typeof value === "string" && value.trim() !== "",
            );
            const objectId = item.id ?? item.ID;
            // Several providers return an id and a name without a permalink. Keep
            // that queried record visible without manufacturing an external URL.
            if (
              title === undefined ||
              (uri === undefined &&
                typeof objectId !== "string" &&
                typeof objectId !== "number")
            )
              return [];
            const identity =
              uri ??
              `${context.origin.toolCallId ?? context.toolName}:${String(objectId)}`;
            return [
              {
                id: `integration:${provider}:${identity}`,
                kind: "other" as const,
                title: title.trim(),
                ...structuredSourceContent(item),
                ...(uri === undefined ? {} : { uri }),
                locations: [],
                evidence: "queried" as const,
                origins: [context.origin],
                score: 85,
                metadata: {
                  provider,
                  ...(uri === undefined
                    ? { addressUnavailable: true, objectId: String(objectId) }
                    : {}),
                },
              },
            ];
          }),
      );
    },
  };
}
