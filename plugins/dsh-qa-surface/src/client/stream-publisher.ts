/**
 * Spacing for a running turn's stream frames. A running turn's frames arrive
 * at animation-frame cadence, so re-projections are spaced at least the
 * configured interval apart: the first frame of a window projects at once and
 * further frames share one trailing projection of the latest state. A review
 * can start on the last frame before the reviewer goes quiet. Leaving a
 * running turn clears pending work and projects immediately. Zero disables
 * the spacing entirely.
 */
export class StreamPublisher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: (() => void) | undefined;

  constructor(private readonly intervalMs: number) {}

  /**
   * Deliver one notification. `running` says whether the bound session is
   * mid-turn; `emit` performs the actual projection and must stay cheap to
   * defer.
   */
  publish(running: boolean, emit: () => void): void {
    if (this.intervalMs <= 0 || !running) {
      this.clear();
      emit();
      return;
    }
    if (this.timer !== undefined) {
      this.pending = emit;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const pending = this.pending;
      this.pending = undefined;
      if (pending !== undefined) this.publish(true, pending);
    }, this.intervalMs);
    emit();
  }

  /**
   * Cancel an absorbed window so the next frame projects at once. Called
   * when the binding goes away or the controller winds down: a stale window
   * must not swallow the first frame of a fresh binding.
   */
  clear(): void {
    this.pending = undefined;
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
