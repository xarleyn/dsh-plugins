import { dedupeAndRankSources } from "./dedupe.js";
import type {
  QaSourceReference,
  QaTurnSources,
  SourceExtractorContext,
} from "./types.js";
import { SourceExtractorRegistry } from "./extractors.js";

export interface QaSourceCollectorOptions {
  readonly sessionId: string;
  readonly turn: number;
  readonly registry: SourceExtractorRegistry;
  readonly displayScoreThreshold?: number;
}

/** Mutable turn-local accumulator; snapshots are immutable plain data. */
export class QaSourceCollector {
  private readonly collected: QaSourceReference[] = [];
  private readonly incompleteOrigins: {
    subagentRunId?: string;
    provider?: string;
    reason: string;
  }[] = [];
  private readonly threshold: number;

  constructor(private readonly options: QaSourceCollectorOptions) {
    this.threshold = options.displayScoreThreshold ?? 50;
  }

  observe(context: SourceExtractorContext): void {
    this.collected.push(...this.options.registry.extract(context));
  }

  add(sources: readonly QaSourceReference[]): void {
    this.collected.push(...sources);
  }

  markIncomplete(origin: {
    readonly subagentRunId?: string;
    readonly provider?: string;
    readonly reason: string;
  }): void {
    this.incompleteOrigins.push({ ...origin });
  }

  snapshot(): QaTurnSources {
    const ranked = dedupeAndRankSources(this.collected);
    const sources = ranked.filter(
      (source) =>
        source.evidence !== "discovered" && source.score >= this.threshold,
    );
    const discovered = ranked.filter((source) => !sources.includes(source));
    return {
      version: 1,
      sessionId: this.options.sessionId,
      turn: this.options.turn,
      sources,
      ...(discovered.length === 0 ? {} : { discovered }),
      complete: this.incompleteOrigins.length === 0,
      ...(this.incompleteOrigins.length === 0
        ? {}
        : { incompleteOrigins: [...this.incompleteOrigins] }),
    };
  }
}
