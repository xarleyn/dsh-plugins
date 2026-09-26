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
  fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
  fireEvent.click(await screen.findByRole("tab", { name: "Runs" }));
}

describe("client page: run history", () => {
  it("lists a run started elsewhere, with the chat that started it", async () => {
    renderPage({ recentAudits: audited(RUNS) });
    await openRuns();
    // The caller session is the handle this page shares with the chat side.
    const callers = await screen.findAllByTestId(
      "domain-experts-editor-run-caller",
    );
    expect(callers.map((node) => node.textContent)).toEqual([
      "chat-42",
      "chat-43",
    ]);
    expect(
      screen
        .getAllByTestId("domain-experts-editor-run-duration")
        .map((cell) => cell.textContent),
    ).toEqual(["4.2 s", "120 ms"]);
    // A background run says so, and a delegated one names the path it came by.
    expect(
      screen.getAllByTestId("domain-experts-editor-run-background"),
    ).toHaveLength(1);
    expect(
      screen
        .getAllByTestId("domain-experts-editor-run-path")
        .map((chip) => chip.textContent),
    ).toEqual(["inventory > payments"]);
    expect(
      screen
        .getAllByTestId("domain-experts-editor-run-degraded")
        .map((chip) => chip.textContent),
    ).toEqual(["1 degraded"]);
  });

  it("keeps another domain's runs out of the list", async () => {
    renderPage({ recentAudits: audited(RUNS) });
    await openRuns();
    const rows = await screen.findAllByTestId("domain-experts-editor-run");
    expect(rows).toHaveLength(2);
    expect(
      screen
        .getAllByTestId("domain-experts-editor-run-caller")
        .map((node) => node.textContent),
    ).toEqual(["chat-42", "chat-43"]);
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
      await screen.findByTestId("domain-experts-editor-runs-empty"),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("domain-experts-editor-runs-refresh"));
    const callers = await screen.findAllByTestId(
      "domain-experts-editor-run-caller",
    );
    expect(callers.map((node) => node.textContent)).toEqual([
      "chat-42",
      "chat-43",
    ]);
  });

  it("explains an empty history instead of leaving the tab blank", async () => {
    renderPage();
    await openRuns();
    expect(
      await screen.findByTestId("domain-experts-editor-runs-empty"),
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
      (await screen.findByTestId("domain-experts-editor-runs-error"))
        .textContent,
    ).toContain("STORAGE_UNAVAILABLE: domain storage is not open");
  });
});
