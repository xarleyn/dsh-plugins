import { describe, expect, it } from "vitest";
import {
  WorkerRegistry,
  type DomainWorker,
} from "../src/host/workers/registry.js";

const CODE: DomainWorker = {
  id: "code_worker",
  title: "Code worker",
  capabilities: ["read-files", "search"],
  enforces: ["filesystem"],
  tool: "code_worker",
};

const JIRA_UNTYPED: DomainWorker = {
  id: "jira_worker",
  title: "Jira worker",
  capabilities: ["search"],
  enforces: [],
  tool: "",
};

describe("worker registry", () => {
  it("registers, lists and disposes a worker", () => {
    const registry = new WorkerRegistry();
    const dispose = registry.register(CODE);
    expect(registry.list().map((worker) => worker.id)).toEqual(["code_worker"]);
    expect(registry.info()[0]).toEqual({
      id: "code_worker",
      title: "Code worker",
      capabilities: ["read-files", "search"],
      enforces: ["filesystem"],
      builtin: false,
    });
    dispose();
    expect(registry.list()).toEqual([]);
  });

  it("refuses a duplicate and a malformed id", () => {
    const registry = new WorkerRegistry();
    registry.register(CODE);
    expect(() => registry.register(CODE)).toThrowError(/already registered/u);
    expect(() =>
      registry.register({ ...CODE, id: "Code Worker" }),
    ).toThrowError(/must match/u);
  });

  it("selects a worker by its id or by its tool name", () => {
    const registry = new WorkerRegistry();
    registry.register(CODE);
    expect(registry.selectedFor(["code_worker"], [])).toHaveLength(1);
    expect(registry.selectedFor(["code_worker"], [])).toHaveLength(1);
    expect(registry.selectedFor(["other"], [])).toEqual([]);
  });

  it("drops a worker that the domain denies", () => {
    const registry = new WorkerRegistry();
    registry.register(CODE);
    expect(registry.selectedFor(["code_worker"], ["code_worker"])).toEqual([]);
  });

  it("reports which providers the selected workers enforce", () => {
    const registry = new WorkerRegistry();
    registry.register(CODE);
    registry.register({ ...JIRA_UNTYPED, enforces: ["filesystem", "jira"] });
    const selected = registry.selectedFor(["code_worker", "jira_worker"], []);
    expect(registry.enforcedProviders(selected)).toEqual([
      "filesystem",
      "jira",
    ]);
    expect(registry.enforcersOf(selected, "filesystem")).toEqual([
      "code_worker",
      "jira_worker",
    ]);
    expect(registry.enforcersOf(selected, "jira")).toEqual(["jira_worker"]);
    expect(registry.enforcersOf(selected, "wiki")).toEqual([]);
  });

  it("claims nothing for a worker that declares no enforcement", () => {
    const registry = new WorkerRegistry();
    registry.register(JIRA_UNTYPED);
    const selected = registry.selectedFor(["jira_worker"], []);
    expect(registry.enforcedProviders(selected)).toEqual([]);
  });
});
