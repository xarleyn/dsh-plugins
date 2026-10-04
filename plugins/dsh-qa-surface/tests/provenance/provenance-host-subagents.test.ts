import { describe, expect, it } from "vitest";
import {
  QA_REPORT_SOURCES_TOOL,
  QaProvenanceHost,
} from "../../src/provenance/host-store.js";
import { resolveConfig } from "../../src/resolve-config.js";
import {
  event,
  fakeSession,
  harness,
  readEvents,
} from "./provenance-host.helpers.js";

describe("Host provenance lifecycle", () => {
  it("bubbles nested observable child sources to the root turn", () => {
    const root = fakeSession("root", [event("turn/start", { turn: 4 }, 0)]);
    const childA = fakeSession(
      "child-a",
      [event("turn/start", { turn: 1 }, 0)],
      "root",
    );
    const childB = fakeSession(
      "child-b",
      readEvents("D:/repo/docs/nested.md"),
      "child-a",
    );
    const world = harness([root.session, childA.session, childB.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    world.emit("subagent/start", {
      runId: "run-a",
      provider: "local",
      id: "child-a",
      local: true,
    });
    world.emit("subagent/start", {
      runId: "run-b",
      provider: "local",
      id: "child-b",
      local: true,
    });
    world.emit("subagent/end", {
      runId: "run-b",
      provider: "local",
      id: "child-b",
      local: true,
    });

    expect(host.bundles("root")[0]).toMatchObject({
      turn: 4,
      sources: [
        {
          id: "file:docs/nested.md",
          evidence: "inherited",
          origins: [
            {
              role: "subagent",
              subagentRunId: "run-b",
              subagentSessionId: "child-b",
            },
          ],
        },
      ],
    });
    host.dispose();
  });

  it("accepts opaque reports and marks missing reports incomplete", async () => {
    const root = fakeSession("root", [event("turn/start", { turn: 2 }, 0)]);
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    world.emit("subagent/start", {
      runId: "run-reported",
      provider: "remote",
      id: "opaque-1",
      local: false,
    });
    const tool = world.getTool();
    expect(tool?.name).toBe(QA_REPORT_SOURCES_TOOL);
    await tool?.execute(
      {
        sources: [
          {
            kind: "web",
            title: "Remote docs",
            uri: "https://example.com/docs?utm_source=agent",
          },
        ],
      },
      { agent: { id: "opaque-1" }, callId: "report-1" } as never,
    );
    world.emit("subagent/end", {
      runId: "run-reported",
      provider: "remote",
      id: "opaque-1",
      local: false,
    });
    expect(host.bundles("root")[0]).toMatchObject({
      complete: true,
      sources: [{ id: "web:https://example.com/docs", evidence: "reported" }],
    });

    world.emit("subagent/start", {
      runId: "run-missing",
      provider: "remote",
      id: "opaque-2",
      local: false,
    });
    world.emit("subagent/end", {
      runId: "run-missing",
      provider: "remote",
      id: "opaque-2",
      local: false,
    });
    expect(host.bundles("root")[0]).toMatchObject({
      complete: false,
      incompleteOrigins: [{ subagentRunId: "run-missing", provider: "remote" }],
    });
    host.dispose();
  });

  /**
   * Seen on the live stand: the chat's own agent called `qa_report_sources`
   * with a well-formed file and web source and was answered
   * `Recorded 0 source(s).`, so the «Источники» panel never opened. Whether a
   * report may be recorded is not what `validateReportedSources` governs — the
   * flag says an entry has to carry an address — so an addressed entry the
   * model files from its own chat lands in that chat's current turn, exactly
   * where a tool-derived source of the same turn would.
   */
  it("records an addressed report the QA agent files from its own chat", async () => {
    const root = fakeSession("root", [event("turn/start", { turn: 3 }, 0)]);
    const world = harness([root.session]);
    const host = new QaProvenanceHost(world.ctx, () => resolveConfig());

    const outcome = (await world.getTool()?.execute(
      {
        sources: [
          {
            kind: "file",
            title: "Skills guide",
            path: "D:/repo/.dsh/skills/guide.md",
          },
          {
            kind: "web",
            title: "Release notes",
            uri: "https://example.com/docs/notes?utm_source=agent",
          },
        ],
      },
      { agent: { id: "root" }, callId: "report-parent" } as never,
    )) as { accepted: number } | undefined;

    expect(outcome).toEqual({ accepted: 2 });
    expect(host.bundles("root")[0]).toMatchObject({
      turn: 3,
      complete: true,
      sources: [
        {
          id: "file:.dsh/skills/guide.md",
          kind: "file",
          evidence: "reported",
          origins: [{ role: "parent", sessionId: "root", turn: 3 }],
        },
        {
          id: "web:https://example.com/docs/notes",
          kind: "web",
          evidence: "reported",
        },
      ],
    });
    host.dispose();
  });

  it("records an unaddressed report only when reported-source validation is off", async () => {
    const report = {
      sources: [
        {
          kind: "other",
          title: "Профиль текущего QA-пользователя",
          snippet: "Предпочтение «эплочка»",
          metadata: { note: "из системной информации" },
        },
      ],
    };
    const collect = async (
      validateReportedSources: boolean,
      /** Call the tool from the QA agent itself instead of a delegated run. */
      caller = "opaque-1",
    ) => {
      const root = fakeSession("root", [event("turn/start", { turn: 2 }, 0)]);
      const world = harness([root.session]);
      const host = new QaProvenanceHost(world.ctx, () =>
        resolveConfig({ sources: { subagents: { validateReportedSources } } }),
      );
      if (caller !== "root") {
        world.emit("subagent/start", {
          runId: "run-opaque",
          provider: "remote",
          id: caller,
          local: false,
        });
      }
      const accepted = (
        (await world.getTool()?.execute(report, {
          agent: { id: caller },
          callId: "report-unaddressed",
        } as never)) as { accepted: number } | undefined
      )?.accepted;
      const sources = host.bundles("root")[0]?.sources ?? [];
      host.dispose();
      return { accepted, sources };
    };

    expect(await collect(true)).toEqual({ accepted: 0, sources: [] });
    expect(await collect(false)).toMatchObject({
      accepted: 1,
      sources: [
        {
          id: "reported:other:Профиль текущего QA-пользователя",
          kind: "other",
          title: "Профиль текущего QA-пользователя",
          evidence: "reported",
          origins: [{ role: "subagent", subagentRunId: "run-opaque" }],
        },
      ],
    });
    // The QA agent itself reaching for the tool is the case a deployment
    // testing facts-as-sources hits; without the flag the entry is refused.
    expect(await collect(true, "root")).toEqual({ accepted: 0, sources: [] });
    expect(await collect(false, "root")).toMatchObject({
      accepted: 1,
      sources: [
        {
          id: "reported:other:Профиль текущего QA-пользователя",
          origins: [{ role: "parent", sessionId: "root", turn: 2 }],
        },
      ],
    });
  });
});
