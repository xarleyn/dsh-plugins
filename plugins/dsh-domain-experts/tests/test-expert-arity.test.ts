import { describe, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { apply } from "../src/client/index.js";
import type { ApiOutcome, DomainExpertsRemote } from "../src/client/remote.js";
import type { ExpertRunResult } from "../src/types.js";

/**
 * Regression guard for the test-run call's argument count.
 *
 * The mounted Remote client compares the call's argument count with the
 * endpoint's parameter count before it builds the request, and an optional
 * parameter still counts: `domainExperts/testExpert` takes four
 * (`domainId`, `task`, `parentSessionId`, `structuredOutput?`), so a wrapper
 * that forwarded the page's three arguments was rejected client-side with
 * "expected 4 argument(s), got 3" and the Test tab's `Running…` never resolved
 * (L08). The page keeps its three-argument call; the wrapper owns the fourth.
 */

type TestExpertArgs = Parameters<DomainExpertsRemote["testExpert"]>;

/** A stubbed namespace method that records the arguments it was handed. */
type TestExpertStub = (...values: TestExpertArgs) => Promise<unknown>;

const ENVELOPE = { ok: true, code: "", message: "" };

function acceptedRun(): Promise<{ ok: true; value: ExpertRunResult }> {
  return Promise.resolve({ ok: true, value: { ...ENVELOPE, result: null } });
}

interface TestApi {
  testExpert(
    id: string,
    task: string,
    parentSessionId: string,
  ): Promise<ApiOutcome<ExpertRunResult>>;
}

interface Harness {
  readonly ctx: Context;
  /** The face the bundle registers for its page, narrowed to the test call. */
  readonly apiOf: () => TestApi;
}

function harnessOf(testExpert: TestExpertStub): Harness {
  const ctx = new Context();
  const registrations: { props: Record<string, unknown> }[] = [];
  const namespace = { testExpert } as unknown as DomainExpertsRemote;

  ctx.provide("remote", {
    domainExperts: namespace,
    $mount: () => Promise.resolve(() => Promise.resolve()),
  });
  ctx.provide("remote.domainExperts", namespace);
  ctx.provide("sessions", { list: { getSnapshot: () => ({}) } });
  ctx.provide("slots", {
    inject: (_key: string, callback: () => (() => void) | void) => {
      void callback();
      return () => undefined;
    },
    register: (options: { inject?: () => Record<string, unknown> }) => {
      registrations.push({ props: options.inject?.() ?? {} });
      return () => undefined;
    },
  });

  return {
    ctx,
    apiOf: () => {
      const props = registrations[0]?.props as { api?: TestApi } | undefined;
      if (props?.api === undefined) {
        throw new Error("the bundle registered no page api");
      }
      return props.api;
    },
  };
}

describe("client testExpert arity", () => {
  it("forwards a fourth structuredOutput argument and returns the collapsed outcome", async () => {
    const testExpert = vi.fn<TestExpertStub>(() => acceptedRun());
    const harness = harnessOf(testExpert);
    await apply(harness.ctx);

    const outcome = await harness
      .apiOf()
      .testExpert("answer-reviewer", "Explain the main flow.", "session-1");

    expect(testExpert).toHaveBeenCalledTimes(1);
    const forwarded = testExpert.mock.calls[0];
    expect(forwarded).toHaveLength(4);
    expect(forwarded).toEqual([
      "answer-reviewer",
      "Explain the main flow.",
      "session-1",
      // A plain investigated run: the host's own test path defaults to `false`.
      false,
    ]);
    expect(outcome).toEqual({
      ok: true,
      data: { ...ENVELOPE, result: null },
    });
  });

  it("reaches a gateway-shaped namespace that rejects any count but four", async () => {
    /*
     * Mirrors `prepareInvocation` in the gateway's client: the check is on
     * `values.length`, so `undefined` or `false` both satisfy it, and only a
     * call that actually carries four arguments gets past it. This is the
     * rejection L08 recorded: the page's three-argument call, forwarded as
     * three, never reached the host.
     */
    const testExpert = vi.fn<TestExpertStub>((...values) => {
      if (values.length !== 4) {
        throw new Error(
          `client api: domainExperts/testExpert expected 4 argument(s), got ${String(values.length)}`,
        );
      }
      return acceptedRun();
    });
    const harness = harnessOf(testExpert);
    await apply(harness.ctx);

    await expect(
      harness
        .apiOf()
        .testExpert("answer-reviewer", "Explain the main flow.", "session-1"),
    ).resolves.toEqual({ ok: true, data: { ...ENVELOPE, result: null } });
  });

  it("keeps the refusal envelope of a host-refused run", async () => {
    const testExpert = vi.fn<TestExpertStub>(() =>
      Promise.resolve({
        ok: true,
        value: {
          ok: false,
          code: "TEST_PARENT_MISSING",
          message: "The test needs a live parent session.",
          result: null,
        },
      }),
    );
    const harness = harnessOf(testExpert);
    await apply(harness.ctx);

    const outcome = await harness
      .apiOf()
      .testExpert("answer-reviewer", "Explain the main flow.", "session-1");

    expect(testExpert.mock.calls[0]).toHaveLength(4);
    expect(outcome).toEqual({
      ok: false,
      code: "TEST_PARENT_MISSING",
      message: "The test needs a live parent session.",
    });
  });
});
