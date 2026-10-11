import { describe, expect, it, vi } from "vitest";
import { DecisionClient, Gate, endpoint } from "../src/client.js";
import { resolveConfig } from "../src/config.js";
const question = {
  id: "check",
  type: "noul",
  instructions: "Is this a defect?",
};
const response = () =>
  new Response(
    JSON.stringify({
      model: "model-alias",
      answers: { check: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 30, output_tokens: 6 },
    }),
  );
const cfg = () =>
  resolveConfig({
    backends: [
      { id: "local", baseUrl: "http://scorer.example", apiKeyEnv: "DEMO_KEY" },
    ],
  });
describe("bounded client", () => {
  it("sends the typed contract, forwards a key, preserves metadata and avoids redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    const client = new DecisionClient(cfg(), fetcher, {
      DEMO_KEY: "synthetic-key",
    });
    const result = await client.ask(
      "The export crashes.",
      [question],
      undefined,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      model: "model-alias",
      usage: { input_tokens: 30 },
      answers: { check: { decision: "yes" } },
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "http://scorer.example/v1/systemone",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: { authorization: "Bearer synthetic-key" },
    });
    expect(
      JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string),
    ).toMatchObject({
      state: "The export crashes.",
      questions: { check: { type: "noul" } },
    });
    expect(JSON.stringify(client.capabilities())).not.toContain(
      "synthetic-key",
    );
    expect(endpoint("http://scorer.example/custom")).toBe(
      "http://scorer.example/custom",
    );
  });
  it("refuses oversized state and request before dispatch without truncation", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new DecisionClient(cfg(), fetcher, {
      DEMO_KEY: "synthetic-key",
    });
    await expect(
      client.ask(
        "я".repeat(5000),
        [question],
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/STATE_LIMIT/);
    const raw = resolveConfig({
      maxStateTokens: 100,
      maxRequestTokens: 101,
      backends: [
        { id: "local", baseUrl: "http://scorer.example", apiKeyEnv: "" },
      ],
    });
    await expect(
      new DecisionClient(raw, fetcher).ask(
        "x",
        [{ ...question, instructions: "Is this a defect? ".repeat(40) }],
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/REQUEST_LIMIT/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not dispatch unconfigured credentials, unknown providers or unsupported kinds", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new DecisionClient(cfg(), fetcher, {});
    const signal = new AbortController().signal;
    await expect(
      client.ask("x", [question], undefined, signal),
    ).rejects.toThrow(/NOT_CONFIGURED/);
    await expect(client.ask("x", [question], "other", signal)).rejects.toThrow(
      /UNKNOWN_BACKEND/,
    );
    const other = resolveConfig({
      backends: [
        {
          id: "local",
          baseUrl: "http://scorer.example",
          apiKeyEnv: "",
          kinds: ["choice"],
        },
      ],
    });
    await expect(
      new DecisionClient(other, fetcher).ask(
        "x",
        [question],
        undefined,
        signal,
      ),
    ).rejects.toThrow(/UNSUPPORTED_KIND/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds the streamed response and never echoes server errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("x".repeat(300000)))
      .mockResolvedValueOnce(
        new Response("synthetic-private-body", { status: 500 }),
      );
    const client = new DecisionClient(cfg(), fetcher, {
      DEMO_KEY: "synthetic-key",
    });
    const signal = new AbortController().signal;
    await expect(
      client.ask("x", [question], undefined, signal),
    ).rejects.toThrow(/RESPONSE_LIMIT/);
    await expect(
      client.ask("x", [question], undefined, signal),
    ).rejects.toThrow(/HTTP_500/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("includes queue time in deadline and closes in-flight and queued calls", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            ),
          ),
      );
    const client = new DecisionClient({ ...cfg(), timeoutMs: 100 }, fetcher, {
      DEMO_KEY: "synthetic-key",
    });
    const signal = new AbortController().signal;
    const first = client.ask("x", [question], undefined, signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = client.ask("x", [question], undefined, signal);
    const outcomes = await Promise.allSettled([first, second]);
    expect(
      outcomes.every(
        (o) => o.status === "rejected" && String(o.reason).includes("TIMEOUT"),
      ),
    ).toBe(true);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
    const active = client.ask("x", [question], undefined, signal);
    const queued = client.ask("x", [question], undefined, signal);
    await Promise.resolve();
    client.close();
    const closed = await Promise.allSettled([active, queued]);
    expect(
      closed.every(
        (o) =>
          o.status === "rejected" && String(o.reason).includes("CANCELLED"),
      ),
    ).toBe(true);
  });
});
describe("queue", () => {
  it("caps waiting calls, removes a cancelled waiter, and releases idempotently", async () => {
    const gate = new Gate(1, 1);
    const signal = new AbortController().signal;
    const release = await gate.acquire(signal);
    const controller = new AbortController();
    const waiting = gate.acquire(controller.signal);
    await expect(gate.acquire(signal)).rejects.toThrow(/BUSY/);
    controller.abort();
    await expect(waiting).rejects.toThrow(/CANCELLED/);
    const next = gate.acquire(signal);
    release();
    release();
    (await next)();
    (await gate.acquire(signal))();
  });
});
