import { describe, expect, it } from "vitest";
import { createDomainExpertTool } from "../src/host/tools/domain-expert.js";
import { domainOf } from "./helpers/fakes.js";
import {
  AGENT,
  call,
  execOf,
  harnessOf,
  propertiesOf,
  renderText,
} from "./tools.helpers.js";

describe("tools: domain_expert", () => {
  it("runs a domain for a top-level caller with no caller domain", async () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    const value = await call(
      tool,
      { domain: "payments", task: "why is it stale" },
      AGENT,
    );
    expect(harness.runs).toEqual([
      {
        domainId: "payments",
        callerDomain: null,
        task: "why is it stale",
        background: false,
      },
    ]);
    expect(value["status"]).toBe("completed");
    expect(value["summary"]).toBe("answer from payments");
    expect(value["durationMs"]).toBe(1234);
    expect(renderText(tool, {}, value)).toContain(
      "domain=payments status=completed",
    );
  });

  it("treats a call from another expert as a delegation", async () => {
    const harness = harnessOf();
    harness.tracker.register({
      domainId: "payments",
      childSessionId: "session-1",
      callerSessionId: "root",
      callerDomain: null,
      path: ["payments"],
      depth: 1,
      background: false,
      maxParallel: 3,
    });
    const tool = createDomainExpertTool(harness.dependencies);
    await call(tool, { domain: "inventory", task: "stock rules" }, AGENT);
    expect(harness.runs[0]?.callerDomain).toBe("payments");
  });

  it("refuses a delegation the caller's policy forbids", async () => {
    const harness = harnessOf();
    harness.tracker.register({
      domainId: "inventory",
      childSessionId: "session-1",
      callerSessionId: "root",
      callerDomain: null,
      path: ["inventory"],
      depth: 1,
      background: false,
      maxParallel: 3,
    });
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(
      tool,
      { domain: "payments", task: "x" },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("[DELEGATION_DENIED]");
    expect((error as Error).message).toContain("cross-domain access disabled");
    expect(harness.runs).toEqual([]);
    expect(harness.warnings).toContain("domain-expert/refused");
  });

  it("refuses delegating to your own domain", async () => {
    const harness = harnessOf();
    harness.tracker.register({
      domainId: "payments",
      childSessionId: "session-1",
      callerSessionId: "root",
      callerDomain: null,
      path: ["payments"],
      depth: 1,
      background: false,
      maxParallel: 3,
    });
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(
      tool,
      { domain: "payments", task: "x" },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("your own domain");
  });

  it("refuses to exceed the parallel expert budget", async () => {
    const harness = harnessOf();
    for (const id of ["a", "b", "c"]) {
      harness.tracker.register({
        domainId: "payments",
        childSessionId: id,
        callerSessionId: "session-1",
        callerDomain: null,
        path: ["payments"],
        depth: 1,
        background: false,
        maxParallel: 3,
      });
    }
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(
      tool,
      { domain: "payments", task: "x" },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("[PARALLELISM_EXCEEDED]");
    expect((error as Error).message).toContain(
      "allows 3 parallel expert calls",
    );
  });

  it("reports a missing domain with its code and the known ids", async () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(tool, { domain: "ghost", task: "x" }, AGENT).catch(
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain("[DOMAIN_NOT_FOUND]");
    expect((error as Error).message).toContain("inventory, payments");
  });

  it("reports a disabled domain with its own code", async () => {
    const harness = harnessOf([domainOf("payments", { enabled: false })]);
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await call(
      tool,
      { domain: "payments", task: "x" },
      AGENT,
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("[DOMAIN_DISABLED]");
  });

  it("declares the mode vocabulary so an unknown one is refused before execution", () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    expect(propertiesOf(tool)["mode"]?.enum).toEqual([
      "investigate",
      "answer",
      "review",
    ]);
  });

  it("passes the background flag through", async () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    await call(
      tool,
      { domain: "payments", task: "x", background: true },
      AGENT,
    );
    expect(harness.runs[0]?.background).toBe(true);
  });

  it("refuses without a calling agent", async () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    const error = await tool
      .execute(
        { domain: "payments", task: "x" },
        { ...execOf(AGENT), agent: undefined },
      )
      .catch((thrown: unknown) => thrown);
    expect((error as Error).message).toContain("requires a calling agent");
  });

  it("declares a render and a presentation for every call", () => {
    const harness = harnessOf();
    const tool = createDomainExpertTool(harness.dependencies);
    expect(typeof tool.output.render).toBe("function");
    expect(
      tool.presentCall?.({ domain: "payments", task: "t" })?.title,
    ).toContain("payments");
  });
});
