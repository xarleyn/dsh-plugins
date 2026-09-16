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
  /** The refusal already reported, so a repeating failure reaches the console once. */
  private refusal = "";
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
    this.refusal = "";
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
   *
   * A refused fetch is not the same fact as an empty bundle set: the panel
   * renders both as "this answer carries no sources", so without a word here a
   * rejected RPC — an unattested chat, a token the Host no longer accepts —
   * would be indistinguishable from a chat that genuinely has none. The
   * refusal is reported once per distinct reason, because this runs on every
   * publish.
   */
  async refresh(sessionId: string, onChanged: () => void): Promise<void> {
    if (this.refreshing) return;
    const generation = this.generation;
    this.refreshing = true;
    try {
      const result = await this.sourceApi.sources(this.token(), sessionId);
      if (generation !== this.generation) return;
      if (!result.ok) {
        const refusal = refusalKey(result.error);
        if (refusal !== this.refusal) {
          this.refusal = refusal;
          console.warn(
            "dsh-qa-surface: the Host refused this chat's source bundles; showing only what the transcript itself carries",
            result.error,
          );
        }
        return;
      }
      this.refusal = "";
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

/** Stable text for one refusal, so the same failure is not reported twice. */
function refusalKey(error: unknown): string {
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return "unserializable refusal";
    }
  }
  return String(error);
}
