// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { ok, renderPage } from "./client-page.helpers.js";
import type { ExpertAuditEntry } from "../src/types.js";

/*
 * Three runs of two domains: one started straight from a conversation, one a
 * delegated background run another domain asked for, and one belonging to a
 * different domain entirely.
 */
const RUNS: readonly ExpertAuditEntry[] = [
  {
    at: 1_700_000_000_000,
    domainId: "payments",
    callerDomain: null,
    callerSessionId: "chat-42",
    childSessionId: "expert-1",
    mode: "investigate",
    background: false,
    status: "completed",
    durationMs: 4200,
    delegatePath: ["payments"],
    degraded: [],
  },
  {
    at: 1_700_000_100_000,
    domainId: "payments",
    callerDomain: "inventory",
    callerSessionId: "chat-43",
    childSessionId: "expert-2",
    mode: "answer",
    background: true,
    status: "delegated",
    durationMs: 120,
    delegatePath: ["inventory", "payments"],
    degraded: ["MEMORY_PROVIDER_MISSING"],
  },
  {
    at: 1_700_000_200_000,
    domainId: "inventory",
    callerDomain: null,
    callerSessionId: "chat-99",
    childSessionId: "expert-3",
    mode: "review",
    background: false,
    status: "error",
    durationMs: 900,
    delegatePath: ["inventory"],
    degraded: [],
  },
];

const audited = (entries: readonly ExpertAuditEntry[]) => () =>
  Promise.resolve(ok({ ok: true, code: "", message: "", entries }));

async function openRuns(): Promise<void> {
  fireEvent.click(await screen.findByText("Payments"));
  fireEvent.click(await screen.findByRole("tab", { name: "Runs" }));
}

describe("client page: run history", () => {
  it("lists a run started elsewhere, with the chat that started it", async () => {
    renderPage({ recentAudits: audited(RUNS) });
    await openRuns();
    // The caller session is the handle this page shares with the chat side.
    expect(await screen.findByTitle("chat-42")).toBeTruthy();
    expect(screen.getByText("4.2 s")).toBeTruthy();
    // A background run says so, and a delegated one names the path it came by.
    expect(screen.getByText("background")).toBeTruthy();
    expect(screen.getByText("inventory > payments")).toBeTruthy();
    expect(screen.getByText("1 degraded")).toBeTruthy();
  });

  it("keeps another domain's runs out of the list", async () => {
    renderPage({ recentAudits: audited(RUNS) });
    await openRuns();
    expect(await screen.findByTitle("chat-42")).toBeTruthy();
    expect(screen.queryByTitle("chat-99")).toBeNull();
  });

  it("re-reads the history when Refresh is asked for", async () => {
    let reads = 0;
    const recentAudits = () => {
      reads += 1;
      return Promise.resolve(
        ok({ ok: true, code: "", message: "", entries: reads > 1 ? RUNS : [] }),
      );
    };
    renderPage({ recentAudits });
    await openRuns();
    expect(
      await screen.findByText(/No runs recorded for this domain/u),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Refresh"));
    expect(await screen.findByTitle("chat-42")).toBeTruthy();
  });

  it("explains an empty history instead of leaving the tab blank", async () => {
    renderPage();
    await openRuns();
    expect(
      await screen.findByText(/No runs recorded for this domain/u),
    ).toBeTruthy();
  });

  it("shows a refused history request as a reason code", async () => {
    renderPage({
      recentAudits: () =>
        Promise.resolve({
          ok: false,
          code: "STORAGE_UNAVAILABLE",
          message: "domain storage is not open",
        }),
    });
    await openRuns();
    expect(
      await screen.findByText(
        /STORAGE_UNAVAILABLE: domain storage is not open/u,
      ),
    ).toBeTruthy();
  });
});
