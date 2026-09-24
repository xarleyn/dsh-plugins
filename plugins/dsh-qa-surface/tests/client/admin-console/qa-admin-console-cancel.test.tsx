// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { adminApi, renderConsole } from "./qa-admin-console.helpers.js";
import type { RemoteResult } from "../../../src/client/types.js";
import type { QaAdminOverview } from "../../../src/types.js";

/**
 * Leaving an aggregate page must stop waiting for it. The overview, the
 * conversation list, the review queue and the analytics page each read the
 * newest conversation logs of the deployment, which on a real store is minutes
 * of work; a reviewer who gives up and opens the next page used to leave the
 * first request running, and the abandoned scans are what parked every other
 * administrative call behind them.
 */

type OverviewCall = (
  token: string,
  signal?: AbortSignal,
) => Promise<RemoteResult<QaAdminOverview>>;

/** A call that answers only by being abandoned. */
function hanging(): { readonly fn: Mock<OverviewCall>; seen: AbortSignal[] } {
  const seen: AbortSignal[] = [];
  const fn = vi.fn<OverviewCall>((_token, signal) => {
    return new Promise((resolve) => {
      seen.push(signal as AbortSignal);
      signal?.addEventListener("abort", () =>
        resolve({ ok: false, error: new Error("gateway/cancelled") }),
      );
    });
  });
  return { fn, seen };
}

describe("admin console cancellation", () => {
  it("cancels the overview read when the console is left", async () => {
    const { fn, seen } = hanging();
    const { unmount } = renderConsole(adminApi({ overview: fn }), "/qa/admin");
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(seen[0]?.aborted).toBe(false);

    unmount();

    expect(seen[0]?.aborted).toBe(true);
  });

  it("cancels the answer a refresh has superseded", async () => {
    const { fn, seen } = hanging();
    renderConsole(adminApi({ overview: fn }), "/qa/admin");
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
    // An abandoned call has no refusal to report: the page is waiting for its
    // newest answer and shows the previous one while it does.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
