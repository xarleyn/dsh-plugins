import { act } from "@testing-library/react";

/**
 * Let the render a resolved promise queues land before asserting.
 *
 * A component that fetches on mount, or clears its draft when a send
 * resolves, updates outside the test's act scope and React reports it as an
 * unwrapped update. One macrotask inside act drains the pending callbacks, so
 * the noise a test causes on purpose stays out of the console. Pass the
 * interaction that starts the chain to keep its own updates covered too.
 */
export async function settle(action?: () => void): Promise<void> {
  await act(async () => {
    action?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}
