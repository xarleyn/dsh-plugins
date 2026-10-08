/**
 * Let the controller's async chain reach its next waiting point: one macrotask
 * per attempt, so every promise it parked in the meantime has settled. Driven by
 * rounds rather than by a clock, because a timed wait measures the runner: the
 * same chain settles in a few rounds on an idle machine and needs many more on a
 * runner shared by a dozen jobs.
 */
export async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (predicate()) return;
  }
  throw new Error("the controller never reached that state");
}
