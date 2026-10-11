import type { Impact } from "./types.js";

export interface ImpactStateOptions {
  maxReminderRounds?: number;
}

export class ImpactState {
  readonly #impacts = new Map<string, Impact>();
  readonly #reminderCounts = new Map<string, number>();
  readonly #maxReminderRounds: number;

  constructor(options: ImpactStateOptions = {}) {
    this.#maxReminderRounds = options.maxReminderRounds ?? 2;
    if (
      !Number.isInteger(this.#maxReminderRounds) ||
      this.#maxReminderRounds < 1
    ) {
      throw new RangeError("maxReminderRounds must be a positive integer");
    }
  }

  reconcile(nextImpacts: Iterable<Impact>): void {
    const next = [...nextImpacts];
    const nextIds = new Set(next.map((impact) => impact.id));

    // A pending impact the current rules no longer produce is retired whether
    // its rule changed shape or left the configuration (disabled or deleted):
    // nothing can satisfy it any more, so it must stop steering the turn.
    for (const [id, impact] of this.#impacts) {
      if (impact.status === "pending" && !nextIds.has(id)) {
        this.#impacts.set(id, { ...impact, status: "superseded" });
      }
    }
    for (const impact of next) {
      const existing = this.#impacts.get(impact.id);
      // The same fingerprint reappearing after it was retired means the rule
      // came back within this turn (switched off then on, or reverted), so the
      // detection is current again. A status the agent or the target files
      // earned deliberately survives.
      this.#impacts.set(
        impact.id,
        existing === undefined || existing.status === "superseded"
          ? impact
          : existing,
      );
    }
  }

  update(impact: Impact): void {
    this.#impacts.set(impact.id, impact);
  }

  /** Every tracked impact regardless of status, in first-seen order. */
  all(): Impact[] {
    return [...this.#impacts.values()];
  }

  pending(): Impact[] {
    return [...this.#impacts.values()].filter(
      (impact) => impact.status === "pending",
    );
  }

  reminderCount(fingerprint: string): number {
    return this.#reminderCounts.get(fingerprint) ?? 0;
  }

  shouldRemind(impact: Impact): boolean {
    if (impact.status !== "pending") return false;
    const count = this.reminderCount(impact.id);
    if (impact.mode === "remind") return count === 0;
    return count < this.#maxReminderRounds;
  }

  recordReminder(impact: Impact): void {
    if (!this.shouldRemind(impact)) return;
    this.#reminderCounts.set(impact.id, this.reminderCount(impact.id) + 1);
  }
}
