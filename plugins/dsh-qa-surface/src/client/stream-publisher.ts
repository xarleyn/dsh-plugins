/**
 * Spacing for a running turn's stream frames. A running turn's frames arrive
 * at animation-frame cadence, so re-projections are spaced at least the
 * configured interval apart: the first frame of a window projects at once and
 * further frames are absorbed (the memoized render path replays nothing, so
 * absorbing a frame only defers it). Everything outside a running turn —
 * phase flips, errors, turn completion — projects immediately, and a
 * non-running notification also cancels an absorbed window so the final
 * state never waits for it. Zero disables the spacing entirely.
 */
export class StreamPublisher {
  private timer: ReturnType<typeof setTimeout> | undefined;

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
    if (this.timer !== undefined) return;
    emit();
    this.timer = setTimeout(() => {
      this.timer = undefined;
    }, this.intervalMs);
  }

  /**
   * Cancel an absorbed window so the next frame projects at once. Called
   * when the binding goes away or the controller winds down: a stale window
   * must not swallow the first frame of a fresh binding.
   */
  clear(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
