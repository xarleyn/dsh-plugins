import type { QaTurnSources } from "../types.js";
import type { QaSourceApi } from "./types.js";

/**
 * Host-side provenance of the bound chat. The client projects turn sources
 * from durable conversation events; the Host bundle (which also carries
 * subagent-inherited evidence) is fetched on the side and merged by turn,
 * Host data winning over the projection.
 */
export class QaHostSourceBridge {
  private bundles: readonly QaTurnSources[] = [];
  private signature = "";
  private refreshing = false;
  /** Bumped on reset so a stale in-flight fetch never lands. */
  private generation = 0;

  constructor(
    private readonly sourceApi: QaSourceApi,
    private readonly token: () => string,
  ) {}

  /** Leave the chat: drop its bundles; merging degrades to the projection. */
  reset(): void {
    this.generation += 1;
    this.bundles = [];
    this.signature = "";
    this.refreshing = false;
  }

  merge(projected: readonly QaTurnSources[]): readonly QaTurnSources[] {
    const merged = new Map<number, QaTurnSources>();
    for (const bundle of projected) merged.set(bundle.turn, bundle);
    for (const bundle of this.bundles) merged.set(bundle.turn, bundle);
    return [...merged.values()].sort((left, right) => left.turn - right.turn);
  }

  /**
   * Fetch the Host bundles of one chat; a changed payload republishes through
   * the callback. Repeated calls coalesce while one is in flight, and a
   * response that outlives the chat is dropped.
   */
  async refresh(sessionId: string, onChanged: () => void): Promise<void> {
    if (this.refreshing) return;
    const generation = this.generation;
    this.refreshing = true;
    try {
      const result = await this.sourceApi.sources(this.token(), sessionId);
      if (!result.ok || generation !== this.generation) return;
      const signature = JSON.stringify(result.value);
      if (signature === this.signature) return;
      this.signature = signature;
      this.bundles = result.value;
      onChanged();
    } finally {
      if (generation === this.generation) this.refreshing = false;
    }
  }
}
