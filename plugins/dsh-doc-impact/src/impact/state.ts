import type { Impact } from './types.js';

export interface ImpactStateOptions {
  maxReminderRounds?: number;
}

export class ImpactState {
  readonly #impacts = new Map<string, Impact>();
  readonly #reminderCounts = new Map<string, number>();
  readonly #maxReminderRounds: number;

  constructor(options: ImpactStateOptions = {}) {
    this.#maxReminderRounds = options.maxReminderRounds ?? 2;
    if (!Number.isInteger(this.#maxReminderRounds) || this.#maxReminderRounds < 1) {
      throw new RangeError('maxReminderRounds must be a positive integer');
    }
  }

  reconcile(nextImpacts: Iterable<Impact>): void {
    const next = [...nextImpacts];
    const nextIds = new Set(next.map((impact) => impact.id));
    const activeRuleIds = new Set(next.map((impact) => impact.ruleId));

    for (const [id, impact] of this.#impacts) {
      if (
        impact.status === 'pending' &&
        activeRuleIds.has(impact.ruleId) &&
        !nextIds.has(id)
      ) {
        this.#impacts.set(id, { ...impact, status: 'superseded' });
      }
    }
    for (const impact of next) {
      const existing = this.#impacts.get(impact.id);
      this.#impacts.set(impact.id, existing ?? impact);
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
    return [...this.#impacts.values()].filter((impact) => impact.status === 'pending');
  }

  reminderCount(fingerprint: string): number {
    return this.#reminderCounts.get(fingerprint) ?? 0;
  }

  shouldRemind(impact: Impact): boolean {
    if (impact.status !== 'pending') return false;
    const count = this.reminderCount(impact.id);
    if (impact.mode === 'remind') return count === 0;
    return count < this.#maxReminderRounds;
  }

  recordReminder(impact: Impact): void {
    if (!this.shouldRemind(impact)) return;
    this.#reminderCounts.set(impact.id, this.reminderCount(impact.id) + 1);
  }
}
