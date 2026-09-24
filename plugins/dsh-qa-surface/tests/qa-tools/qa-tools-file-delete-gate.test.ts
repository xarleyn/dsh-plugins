import { describe, expect, it } from "vitest";
import { QaApprovalGate } from "../../src/approvals.js";
import {
  QA_FILE_DELETE_ASK_REASON,
  QaFileDeleteGate,
} from "../../src/qa-tools/file-delete-gate.js";
import { QaSessionOwnership } from "../../src/session-ownership.js";
import { fakeContext, sessionAgent } from "../helpers/context-fakes.js";

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

function gateFor(input: { attested: readonly string[] }) {
  const fake = fakeContext();
  const ownership = new QaSessionOwnership((sessionId) =>
    input.attested.includes(sessionId),
  );
  const gate = new QaFileDeleteGate(fake.context, ownership);
  gate.install();
  /** Invoke the gate exactly where the tool runtime would. */
  const call = (execution: unknown, next: () => Promise<PreToolDecision>) =>
    fake.handler("tools/pre-execute")(
      execution,
      next,
    ) as Promise<PreToolDecision>;
  return { gate, call, fake };
}

/** A chain that records whether it was consulted, then allows. */
let consulted = 0;
const allow = () => {
  consulted += 1;
  return Promise.resolve<PreToolDecision>({ kind: "allow" });
};
/** Let the whole listener waterfall finish parking before the test reads it. */
const flush = () => new Promise<void>((done) => setTimeout(done, 0));

describe("QA file_delete gate", () => {
  it("answers ask for an attested session without consulting the chain", async () => {
    const { gate, call } = gateFor({ attested: ["s1"] });
    consulted = 0;
    await expect(
      call({ name: "file_delete", agent: sessionAgent("s1") }, allow),
    ).resolves.toEqual({
      kind: "ask",
      reason: QA_FILE_DELETE_ASK_REASON,
    });
    expect(consulted).toBe(0);
    gate.dispose();
  });

  it("hands other tool names to the chain untouched", async () => {
    const { gate, call } = gateFor({ attested: ["s1"] });
    consulted = 0;
    await expect(
      call({ name: "glob", agent: sessionAgent("s1") }, allow),
    ).resolves.toEqual({ kind: "allow" });
    expect(consulted).toBe(1);
    gate.dispose();
  });

  it("hands a caller this deployment did not attest to the chain", async () => {
    const { gate, call } = gateFor({ attested: ["s1"] });
    consulted = 0;
    await expect(
      call({ name: "file_delete", agent: sessionAgent("other") }, allow),
    ).resolves.toEqual({ kind: "allow" });
    expect(consulted).toBe(1);
    gate.dispose();
  });

  it("hands an agentless execution to the chain", async () => {
    const { gate, call } = gateFor({ attested: ["s1"] });
    consulted = 0;
    await expect(call({ name: "file_delete" }, allow)).resolves.toEqual({
      kind: "allow",
    });
    expect(consulted).toBe(1);
    gate.dispose();
  });

  it("sits inside the approval gate, so a deletion parks for the operator", async () => {
    const fake = fakeContext();
    const ownership = new QaSessionOwnership((sessionId) => sessionId === "s1");
    const approvals = new QaApprovalGate(
      fake.context,
      () => true,
      ownership,
      SILENT_LOGGER as never,
    );
    const gate = new QaFileDeleteGate(fake.context, ownership);
    approvals.install();
    gate.install();
    const pending = fake.dispatch(
      "tools/pre-execute",
      { name: "file_delete", agent: sessionAgent("s1") },
      async () => ({ kind: "allow" }) as PreToolDecision,
    ) as Promise<PreToolDecision>;
    await flush();
    const [request] = approvals.list("s1");
    expect(request).toMatchObject({
      toolName: "file_delete",
      reason: QA_FILE_DELETE_ASK_REASON,
    });
    approvals.answer("s1", request!.id, "allowed-once");
    await expect(pending).resolves.toEqual({ kind: "allow" });
    approvals.dispose();
  });

  it("keeps the blocked-approvals refusal for a deletion", async () => {
    const fake = fakeContext();
    const ownership = new QaSessionOwnership((sessionId) => sessionId === "s1");
    const approvals = new QaApprovalGate(
      fake.context,
      () => false,
      ownership,
      SILENT_LOGGER as never,
    );
    const gate = new QaFileDeleteGate(fake.context, ownership);
    approvals.install();
    gate.install();
    await expect(
      fake.dispatch(
        "tools/pre-execute",
        { name: "file_delete", agent: sessionAgent("s1") },
        async () => ({ kind: "allow" }) as PreToolDecision,
      ) as Promise<PreToolDecision>,
    ).resolves.toEqual({
      kind: "deny",
      reason:
        'tool "file_delete" requires approval, but approval interactions are unavailable in QA',
    });
    expect(approvals.list("s1")).toEqual([]);
    approvals.dispose();
  });

  it("detaches its listener on disposal", () => {
    const { gate, fake } = gateFor({ attested: ["s1"] });
    gate.dispose();
    expect(fake.count("tools/pre-execute")).toBe(0);
  });
});
