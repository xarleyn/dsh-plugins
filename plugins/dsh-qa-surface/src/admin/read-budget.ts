/** One deadline shared by every storage phase of an administrative request. */
export interface QaReadBudget {
  remaining(): number;
  read<T>(work: () => Promise<T>, fallback: T): Promise<T>;
}

export const QA_ADMIN_REQUEST_BUDGET_MS = 15_000;

export function readBudget(
  now: () => number,
  ms = QA_ADMIN_REQUEST_BUDGET_MS,
): QaReadBudget {
  const until = now() + ms;
  const monotonicUntil = performance.now() + ms;
  const remaining = () =>
    Math.max(0, Math.min(until - now(), monotonicUntil - performance.now()));
  return {
    remaining,
    async read<T>(work: () => Promise<T>, fallback: T): Promise<T> {
      const ms = remaining();
      if (ms <= 0) return fallback;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work(),
          new Promise<T>((resolve) => {
            timer = setTimeout(() => resolve(fallback), ms);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
