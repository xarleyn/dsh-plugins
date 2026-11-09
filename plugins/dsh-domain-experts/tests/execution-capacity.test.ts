import type {
  SubagentActivation,
  SubagentResult,
} from "@deepseek-ai/dsh-subagent";
import { describe, expect, it } from "vitest";

import { AuditRing } from "../src/host/audit.js";
import {
  RunTracker,
  runExpert,
  type ExecutionDependencies,
} from "../src/host/execution.js";
import { createDomainExpertTool } from "../src/host/tools/domain-expert.js";
import {
  agentOf,
  domainOf,
  fakeSubagents,
  recordingLogger,
} from "./helpers/fakes.js";
import { fixtureOf } from "./scope-resolution.helpers.js";
import { call, harnessOf } from "./tools.helpers.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture(limit = 1, tracker = new RunTracker()) {
  const definition = domainOf("demo");
  const subagents = fakeSubagents();
  const dependencies: ExecutionDependencies = Object.assign(
    {
      resolver: fixtureOf([definition]).dependencies,
      subagents,
      subagentProvider: "spawn",
      tracker,
      audits: new AuditRing(20),
      logger: recordingLogger({ events: [] }),
      now: Date.now,
      perUserMemory: true,
      principalOf: () => "synthetic-account",
    },
    { parallelLimit: () => limit },
  );
  const input = {
    parent: agentOf({ id: "caller-demo" }),
    definition,
    request: {
      task: "Review demo",
      context: "",
      output: "",
      mode: "review" as const,
      background: true,
    },
    signal: new AbortController().signal,
    callerDomain: null,
  };
  return { dependencies, input, subagents, tracker };
}

const completed: SubagentResult = { stopReason: "completed", output: [] };

describe("expert activation capacity", () => {
  it.each(["completed", "aborted", "rejected"])(
    "releases background capacity on %s and retains child identity",
    async (outcome) => {
      const { dependencies, input, subagents, tracker } = fixture();
      const result = deferred<SubagentResult>();
      const start = subagents.startActivation.bind(subagents);
      subagents.startActivation = async (spec) => ({
        ...(await start(spec)),
        result: result.promise,
      });
      const receipt = await runExpert(dependencies, input);
      expect(tracker.countForCaller("caller-demo")).toBe(1);
      const identity = tracker.find(receipt.childSessionId);
      if (outcome === "rejected")
        result.reject(new Error("synthetic provider failure"));
      else
        result.resolve({
          ...completed,
          stopReason: outcome === "aborted" ? "aborted" : "completed",
        });
      await result.promise.catch(() => undefined);
      await Promise.resolve();
      expect(tracker.countForCaller("caller-demo")).toBe(0);
      expect(tracker.find(receipt.childSessionId)).toBe(identity);
      expect(identity?.memoryOwner).toEqual({
        mode: "per-user",
        userId: "synthetic-account",
      });
      expect(subagents.disposed).toEqual([]);
      expect((await runExpert(dependencies, input)).status).toBe("delegated");
    },
  );

  it("atomically admits only one of two parallel tools before activation starts", async () => {
    const { dependencies, input, subagents, tracker } = fixture();
    const pending = deferred<void>();
    const entered = deferred<void>();
    const start = subagents.startActivation.bind(subagents);
    let starts = 0;
    subagents.startActivation = async (spec) => {
      starts += 1;
      entered.resolve();
      await pending.promise;
      return start(spec);
    };
    const tools = harnessOf([input.definition]);
    const tool = createDomainExpertTool({
      ...tools.dependencies,
      run: (request) => runExpert(dependencies, request),
      parallelBudget: () => ({
        active: tracker.countForCaller("caller-demo"),
        limit: 1,
        exceeded: false,
      }),
    });
    // The advisory check above deliberately allows both; the execution seam
    // must make the atomic reservation and cover in-process callers too.
    const calls = Promise.allSettled(
      [0, 1].map(() =>
        call(
          tool,
          { domain: "demo", task: "Review demo", background: true },
          input.parent,
        ),
      ),
    );
    await entered.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const pendingCount = tracker.countForCaller("caller-demo");
    pending.resolve();
    const outcomes = await calls;
    expect(starts).toBe(1);
    expect(pendingCount).toBe(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const refusal = outcomes.find((outcome) => outcome.status === "rejected");
    expect(
      refusal?.status === "rejected" ? String(refusal.reason) : "",
    ).toContain("PARALLELISM_EXCEEDED");
    expect(tracker.countForCaller("caller-demo")).toBe(0);
  });

  it("returns a reserved slot when activation creation rejects", async () => {
    const { dependencies, input, subagents, tracker } = fixture();
    const start = subagents.startActivation.bind(subagents);
    subagents.startActivation = () =>
      Promise.reject(new Error("synthetic start failure"));
    await expect(runExpert(dependencies, input)).rejects.toThrow(
      "synthetic start failure",
    );
    expect(tracker.countForCaller("caller-demo")).toBe(0);
    subagents.startActivation = start;
    await expect(runExpert(dependencies, input)).resolves.toMatchObject({
      status: "delegated",
    });
  });

  it("keeps pending capacity independent from bounded identity eviction and other callers", async () => {
    const { dependencies, input, subagents, tracker } = fixture(
      1,
      new RunTracker(1),
    );
    const results: ReturnType<typeof deferred<SubagentResult>>[] = [];
    subagents.startActivation = async () => {
      const result = deferred<SubagentResult>();
      results.push(result);
      return {
        childId: `child-${results.length}`,
        result: result.promise,
        dispose: async () => {},
      } as SubagentActivation;
    };
    await runExpert(dependencies, input);
    await runExpert(dependencies, {
      ...input,
      parent: agentOf({ id: "other-caller" }),
    });
    expect(tracker.countForCaller("caller-demo")).toBe(1);
    expect(tracker.countForCaller("other-caller")).toBe(1);
    await expect(runExpert(dependencies, input)).rejects.toThrow(
      "parallel expert call",
    );
    for (const result of results) result.resolve(completed);
    await Promise.all(results.map((result) => result.promise));
    expect(tracker.countForCaller("caller-demo")).toBe(0);
    expect(tracker.countForCaller("other-caller")).toBe(0);
  });
});
