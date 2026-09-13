import { describe, expect, it } from "vitest";
import { QaApprovalGate } from "../src/approvals.js";
import { QaSessionOwnership } from "../src/session-ownership.js";
import { fakeContext, sessionAgent } from "./helpers/context-fakes.js";

type PreToolDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "ask"; readonly reason?: string };

const SILENT_LOGGER = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
};

function gateFor(input: { interactive: boolean; attested: readonly string[] }) {
  const fake = fakeContext();
  const ownership = new QaSessionOwnership((sessionId) =>
    input.attested.includes(sessionId),
  );
  const gate = new QaApprovalGate(
    fake.context,
    () => input.interactive,
    ownership,
    SILENT_LOGGER as never,
  );
  gate.install();
  /** Invoke the gate exactly where the tool runtime would. */
  const call = (execution: unknown, next: () => Promise<PreToolDecision>) =>
    fake.handler("tools/pre-execute")(
      execution,
      next,
    ) as Promise<PreToolDecision>;
  return { gate, call, fire: fake.handler, count: fake.count };
}

/** The ask a composed gate hands downstream, wrapped by the QA gate. */
const ask = async (): Promise<PreToolDecision> => ({ kind: "ask" });

describe("QA approval gate", () => {
  it("refuses a parked ask on an attested chat while approvals are blocked", async () => {
    const { gate, call } = gateFor({ interactive: false, attested: ["s1"] });
    await expect(
      call({ name: "glob", agent: sessionAgent("s1") }, ask),
    ).resolves.toEqual({
      kind: "deny",
      reason:
        'tool "glob" requires approval, but approval interactions are unavailable in QA',
    });
    gate.dispose();
  });

  it("leaves a session it did not attest to the composed chain", async () => {
    const { gate, call } = gateFor({ interactive: false, attested: ["s1"] });
    await expect(
      call({ name: "glob", agent: sessionAgent("other") }, ask),
    ).resolves.toEqual({ kind: "ask" });
    expect(gate.list("other")).toEqual([]);
    gate.dispose();
  });

  it("carries a non-ask decision through untouched", async () => {
    const { gate, call } = gateFor({ interactive: true, attested: ["s1"] });
    await expect(
      call({ name: "read", agent: sessionAgent("s1") }, async () => ({
        kind: "allow",
      })),
    ).resolves.toEqual({ kind: "allow" });
    gate.dispose();
  });

  it("parks an ask until the operator allows it once", async () => {
    const { gate, call } = gateFor({ interactive: true, attested: ["s1"] });
    const pending = call(
      { name: "glob", agent: sessionAgent("s1") },
      async () => ({ kind: "ask", reason: "Safety gate requests approval" }),
    );
    await Promise.resolve();
    expect(gate.list("s1")).toEqual([
      {
        id: expect.any(String),
        sessionId: "s1",
        toolName: "glob",
        reason: "Safety gate requests approval",
        createdAt: expect.any(Number),
        delegated: false,
      },
    ]);
    const [request] = gate.list("s1");
    expect(gate.answer("s1", request!.id, "allowed-once")).toBe(true);
    await expect(pending).resolves.toEqual({ kind: "allow" });
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });

  it("reports the operator's refusal with the QA view as its source", async () => {
    const { gate, call } = gateFor({ interactive: true, attested: ["s1"] });
    const pending = call({ name: "read", agent: sessionAgent("s1") }, ask);
    await Promise.resolve();
    const [request] = gate.list("s1");
    gate.answer("s1", request!.id, "rejected");
    await expect(pending).resolves.toEqual({
      kind: "deny",
      reason: 'the QA user rejected tool "read"',
    });
    gate.dispose();
  });

  it("refuses an answer for another chat or an unknown request", async () => {
    const { gate, call } = gateFor({
      interactive: true,
      attested: ["s1", "s2"],
    });
    const pending = call({ name: "glob", agent: sessionAgent("s1") }, ask);
    await Promise.resolve();
    const [request] = gate.list("s1");
    expect(gate.answer("s2", request!.id, "allowed-once")).toBe(false);
    expect(gate.answer("s1", "no-such-request", "allowed-once")).toBe(false);
    expect(gate.list("s1")).toHaveLength(1);
    gate.answer("s1", request!.id, "allowed-once");
    await pending;
    gate.dispose();
  });

  it("lists a delegated child's ask under the chat it belongs to", async () => {
    const { gate, call, fire } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    const child = sessionAgent("s1-child", "s1");
    (fire("session/created") as (session: unknown) => void)(child.session);
    const pending = call({ name: "web_fetch", agent: child }, ask);
    await Promise.resolve();
    const [request] = gate.list("s1");
    expect(request).toMatchObject({ delegated: true, sessionId: "s1" });
    expect(gate.list("s1-child")).toEqual([]);
    gate.answer("s1", request!.id, "allowed-once");
    await expect(pending).resolves.toEqual({ kind: "allow" });
    gate.dispose();
  });

  it("cancels the wait when the turn's signal aborts", async () => {
    const { gate, call } = gateFor({ interactive: true, attested: ["s1"] });
    const controller = new AbortController();
    const pending = call(
      { name: "glob", agent: sessionAgent("s1"), signal: controller.signal },
      ask,
    );
    await Promise.resolve();
    expect(gate.list("s1")).toHaveLength(1);
    controller.abort();
    await expect(pending).resolves.toEqual({
      kind: "deny",
      reason:
        'approval for tool "glob" was cancelled before the QA user answered',
    });
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });

  it("cancels immediately when the call arrives already aborted", async () => {
    const { gate, call } = gateFor({ interactive: true, attested: ["s1"] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      call(
        { name: "glob", agent: sessionAgent("s1"), signal: controller.signal },
        ask,
      ),
    ).resolves.toMatchObject({ kind: "deny" });
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });

  it("fails a parked request when its agent goes away", async () => {
    const { gate, call, fire } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    const pending = call({ name: "glob", agent: sessionAgent("s1") }, ask);
    await Promise.resolve();
    (fire("agent/disposed") as (event: unknown) => void)({
      agent: sessionAgent("s1"),
    });
    await expect(pending).resolves.toMatchObject({ kind: "deny" });
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });

  it("fails every parked request on disposal and detaches its listeners", async () => {
    const { gate, call, count } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    const pending = call({ name: "glob", agent: sessionAgent("s1") }, ask);
    await Promise.resolve();
    gate.dispose();
    await expect(pending).resolves.toMatchObject({
      kind: "deny",
      reason:
        'tool "glob" requires approval, but its QA approval request is gone',
    });
    expect(count("tools/pre-execute")).toBe(0);
  });
});
