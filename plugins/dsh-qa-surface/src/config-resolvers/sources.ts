import { QA_PROVENANCE_RETENTION_LIMITS } from "../provenance/retention.js";
import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import { assertIntInRange } from "./shared.js";

type SourcesSlice = ResolvedQaSurfaceConfig["sources"];

/** Resolve the sources domain: collection, display, and preview bounds. */
export function resolveSources(input: QaSurfaceConfig): SourcesSlice {
  const maxInitiallyVisiblePerGroup =
    input.sources?.display?.maxInitiallyVisiblePerGroup ??
    DEFAULT_QA_SURFACE_CONFIG.sources.display.maxInitiallyVisiblePerGroup;
  const maxPromotedPerSearch =
    input.sources?.webSearch?.maxPromotedPerSearch ??
    DEFAULT_QA_SURFACE_CONFIG.sources.webSearch.maxPromotedPerSearch;
  const maxBytes =
    input.sources?.filePreview?.maxBytes ??
    DEFAULT_QA_SURFACE_CONFIG.sources.filePreview.maxBytes;
  const maxMarkdownRenderBytes =
    input.sources?.filePreview?.maxMarkdownRenderBytes ??
    DEFAULT_QA_SURFACE_CONFIG.sources.filePreview.maxMarkdownRenderBytes;
  const retention = {
    maxTurnsPerSession:
      input.sources?.retention?.maxTurnsPerSession ??
      DEFAULT_QA_SURFACE_CONFIG.sources.retention.maxTurnsPerSession,
    maxSessions:
      input.sources?.retention?.maxSessions ??
      DEFAULT_QA_SURFACE_CONFIG.sources.retention.maxSessions,
    maxAgeDays:
      input.sources?.retention?.maxAgeDays ??
      DEFAULT_QA_SURFACE_CONFIG.sources.retention.maxAgeDays,
    sweepIntervalMinutes:
      input.sources?.retention?.sweepIntervalMinutes ??
      DEFAULT_QA_SURFACE_CONFIG.sources.retention.sweepIntervalMinutes,
  };
  for (const [key, value] of Object.entries(retention)) {
    const limits =
      QA_PROVENANCE_RETENTION_LIMITS[
        key as keyof typeof QA_PROVENANCE_RETENTION_LIMITS
      ];
    assertIntInRange(`sources.retention.${key}`, value, limits.min, limits.max);
  }
  assertIntInRange(
    "sources.display.maxInitiallyVisiblePerGroup",
    maxInitiallyVisiblePerGroup,
    1,
    100,
  );
  assertIntInRange(
    "sources.webSearch.maxPromotedPerSearch",
    maxPromotedPerSearch,
    0,
    50,
  );
  assertIntInRange("sources.filePreview.maxBytes", maxBytes, 1_024, 20_000_000);
  assertIntInRange(
    "sources.filePreview.maxMarkdownRenderBytes",
    maxMarkdownRenderBytes,
    1_024,
    10_000_000,
  );
  if (maxMarkdownRenderBytes > maxBytes) {
    throw new TypeError(
      "dsh-qa-surface: sources.filePreview.maxMarkdownRenderBytes cannot exceed maxBytes",
    );
  }
  return Object.freeze({
    enabled:
      input.sources?.enabled ?? DEFAULT_QA_SURFACE_CONFIG.sources.enabled,
    retention: Object.freeze(retention),
    collect: Object.freeze({
      parentAgent:
        input.sources?.collect?.parentAgent ??
        DEFAULT_QA_SURFACE_CONFIG.sources.collect.parentAgent,
      subagents:
        input.sources?.collect?.subagents ??
        DEFAULT_QA_SURFACE_CONFIG.sources.collect.subagents,
      persistTurnEvent:
        input.sources?.collect?.persistTurnEvent ??
        DEFAULT_QA_SURFACE_CONFIG.sources.collect.persistTurnEvent,
    }),
    display: Object.freeze({
      sidebar:
        input.sources?.display?.sidebar ??
        DEFAULT_QA_SURFACE_CONFIG.sources.display.sidebar,
      footer:
        input.sources?.display?.footer ??
        DEFAULT_QA_SURFACE_CONFIG.sources.display.footer,
      groupByKind:
        input.sources?.display?.groupByKind ??
        DEFAULT_QA_SURFACE_CONFIG.sources.display.groupByKind,
      showDiscovered:
        input.sources?.display?.showDiscovered ??
        DEFAULT_QA_SURFACE_CONFIG.sources.display.showDiscovered,
      showOriginBadges:
        input.sources?.display?.showOriginBadges ??
        DEFAULT_QA_SURFACE_CONFIG.sources.display.showOriginBadges,
      maxInitiallyVisiblePerGroup,
    }),
    webSearch: Object.freeze({
      promoteSearchResultsWithoutFetch:
        input.sources?.webSearch?.promoteSearchResultsWithoutFetch ??
        DEFAULT_QA_SURFACE_CONFIG.sources.webSearch
          .promoteSearchResultsWithoutFetch,
      maxPromotedPerSearch,
    }),
    dedupe: Object.freeze({
      normalizeUrls:
        input.sources?.dedupe?.normalizeUrls ??
        DEFAULT_QA_SURFACE_CONFIG.sources.dedupe.normalizeUrls,
      stripTrackingParams:
        input.sources?.dedupe?.stripTrackingParams ??
        DEFAULT_QA_SURFACE_CONFIG.sources.dedupe.stripTrackingParams,
      mergeFileRanges:
        input.sources?.dedupe?.mergeFileRanges ??
        DEFAULT_QA_SURFACE_CONFIG.sources.dedupe.mergeFileRanges,
    }),
    filePreview: Object.freeze({
      enabled:
        input.sources?.filePreview?.enabled ??
        DEFAULT_QA_SURFACE_CONFIG.sources.filePreview.enabled,
      markdownRenderedByDefault:
        input.sources?.filePreview?.markdownRenderedByDefault ??
        DEFAULT_QA_SURFACE_CONFIG.sources.filePreview.markdownRenderedByDefault,
      allowRawToggle:
        input.sources?.filePreview?.allowRawToggle ??
        DEFAULT_QA_SURFACE_CONFIG.sources.filePreview.allowRawToggle,
      maxBytes,
      maxMarkdownRenderBytes,
    }),
    subagents: Object.freeze({
      inheritSources:
        input.sources?.subagents?.inheritSources ??
        DEFAULT_QA_SURFACE_CONFIG.sources.subagents.inheritSources,
      enableReportToolFallback:
        input.sources?.subagents?.enableReportToolFallback ??
        DEFAULT_QA_SURFACE_CONFIG.sources.subagents.enableReportToolFallback,
      markIncompleteOpaqueRuns:
        input.sources?.subagents?.markIncompleteOpaqueRuns ??
        DEFAULT_QA_SURFACE_CONFIG.sources.subagents.markIncompleteOpaqueRuns,
      validateReportedSources:
        input.sources?.subagents?.validateReportedSources ??
        DEFAULT_QA_SURFACE_CONFIG.sources.subagents.validateReportedSources,
    }),
    legacy: Object.freeze({
      parseAssistantSourcesBlock:
        input.sources?.legacy?.parseAssistantSourcesBlock ??
        DEFAULT_QA_SURFACE_CONFIG.sources.legacy.parseAssistantSourcesBlock,
    }),
  });
}
