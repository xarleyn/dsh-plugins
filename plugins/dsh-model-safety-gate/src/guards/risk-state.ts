/**
 * Per-session turn risk state (design SPEC §18).
 *
 * Tool results from untrusted sources raise the turn risk; subsequent
 * sensitive tool calls in the same turn are decided more strictly. The input
 * guard stamps the current turn on every pre-step (`beginTurn`), so tool
 * guards only record signals and the tracker merges them into the ongoing
 * turn. State is keyed by session; a new turn resets it. The tracker can
 * only escalate: nothing here ever lowers a risk level inside a turn.
 */

export type RiskLevel = "low" | "elevated" | "high";

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = { low: 0, elevated: 1, high: 2 };

export interface TurnRiskState {
  readonly turn: number;
  readonly riskLevel: RiskLevel;
  /** Deduped tool/source labels that contributed risk. */
  readonly sources: readonly string[];
  /** Deduped signal keys (rule ids / categories). */
  readonly signals: readonly string[];
}

export interface RiskSignal {
  readonly riskLevel: RiskLevel;
  /** Tool name / source label that produced the signal. */
  readonly source: string;
  /** Stable signal key (joined rule ids or categories). */
  readonly signalKey: string;
}

const MAX_TRACKED_SESSIONS = 512;

export class TurnRiskTracker {
  private readonly states = new Map<string, TurnRiskState>();

  /**
   * Stamp the session's current turn (called from the input guard pre-step).
   * A new turn number replaces prior state; the same turn keeps it.
   */
  beginTurn(sessionId: string, turn: number): void {
    const previous = this.states.get(sessionId);
    if (previous !== undefined && previous.turn === turn) return;
    this.states.delete(sessionId);
    this.states.set(sessionId, { turn, riskLevel: "low", sources: [], signals: [] });
    this.prune();
  }

  /** Record a risk signal for the session's current turn. */
  mark(sessionId: string, signal: RiskSignal): TurnRiskState | undefined {
    const base = this.states.get(sessionId);
    if (base === undefined) return undefined;
    const next: TurnRiskState = {
      turn: base.turn,
      riskLevel: RISK_ORDER[signal.riskLevel] > RISK_ORDER[base.riskLevel] ? signal.riskLevel : base.riskLevel,
      sources: base.sources.includes(signal.source) ? base.sources : [...base.sources, signal.source].slice(-16),
      signals: base.signals.includes(signal.signalKey) ? base.signals : [...base.signals, signal.signalKey].slice(-32),
    };
    // Refresh insertion order for the size cap.
    this.states.delete(sessionId);
    this.states.set(sessionId, next);
    return next;
  }

  get(sessionId: string): TurnRiskState | undefined {
    return this.states.get(sessionId);
  }

  /** Escalate a surface decision according to the current risk level. */
  escalate(decision: "allow" | "warn" | "review" | "block", riskLevel: RiskLevel | undefined): "allow" | "ask" | "deny" {
    if (riskLevel === "high") {
      if (decision === "allow" || decision === "warn") return "ask";
      return "deny";
    }
    if (riskLevel === "elevated" && decision === "allow") return "ask";
    switch (decision) {
      case "allow":
      case "warn":
        return "allow";
      case "review":
        return "ask";
      case "block":
        return "deny";
    }
  }

  clear(sessionId: string): void {
    this.states.delete(sessionId);
  }

  private prune(): void {
    while (this.states.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.states.keys().next();
      if (oldest.done) break;
      this.states.delete(oldest.value);
    }
  }
}
