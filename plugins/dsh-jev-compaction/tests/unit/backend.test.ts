import { afterEach, describe, expect, it } from "vitest";
import {
  SystemOneClient,
  JevApiKeyMissingError,
  JevTransportError,
  type FetchLike,
} from "../../src/jev/backend.js";
import type { JevQuestion, JevState } from "../../src/jev/types.js";
import { resolveJevCompactionConfig } from "../../src/config.js";

const STATE: JevState = { context: "c", goal: "g", history: [] };
const QUESTIONS: JevQuestion[] = [
  { name: "needContents_t1", instructions: "q1" },
  { name: "needVerbatim_t1", instructions: "q2" },
];

function okFetch(body: unknown): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

async function withEnv<T>(
  name: string,
  value: string | undefined,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

afterEach(() => {
  delete process.env.TYPESAFE_API_KEY;
});

describe("SystemOneClient", () => {
  it("posts the documented wire contract and parses answers", async () => {
    let captured:
      | { url: string; headers: Record<string, string>; body: string }
      | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url, headers: init.headers, body: init.body };
      return okFetch({
        answers: {
          needContents_t1: { noul: 0.2 },
          needVerbatim_t1: { noul: 0.1 },
        },
      })("", init);
    };
    const backend = new SystemOneClient(
      resolveJevCompactionConfig({}),
      fetcher,
    );
    const answers = await withEnv("TYPESAFE_API_KEY", "k", () =>
      backend.score(STATE, QUESTIONS, undefined),
    );
    expect(answers.get("needContents_t1")).toBe(0.2);
    expect(captured?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(captured?.headers.authorization).toBe("Bearer k");
    const parsed = JSON.parse(captured!.body) as {
      model: string;
      state: unknown;
      questions: Record<string, { type: string }>;
    };
    expect(parsed.model).toBe("jev-latest");
    expect(parsed.questions.needContents_t1?.type).toBe("noul");
  });

  it("fails safe on malformed semantic responses", async () => {
    const backend = new SystemOneClient(
      resolveJevCompactionConfig({}),
      okFetch({ answers: { needContents_t1: { noul: 0.2 } } }),
    );
    await expect(
      withEnv("TYPESAFE_API_KEY", "k", () =>
        backend.score(STATE, QUESTIONS, undefined),
      ),
    ).rejects.toThrow(/invalid Jev response/);
  });

  it("throws when the key environment variable is unset", async () => {
    const backend = new SystemOneClient(
      resolveJevCompactionConfig({}),
      okFetch({ answers: {} }),
    );
    await expect(backend.score(STATE, QUESTIONS, undefined)).rejects.toThrow(
      JevApiKeyMissingError,
    );
  });

  it("omits the Authorization header for keyless local backends", async () => {
    let captured: { url: string; headers: Record<string, string> } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url, headers: init.headers };
      return okFetch({
        answers: {
          needContents_t1: { noul: 0.1 },
          needVerbatim_t1: { noul: 0.1 },
        },
      })("", init);
    };
    const backend = new SystemOneClient(
      resolveJevCompactionConfig({
        decision: {
          provider: "custom",
          custom: { baseUrl: "http://openjev:8000", apiKeyEnv: "" },
        },
      }),
      fetcher,
    );
    const answers = await backend.score(STATE, QUESTIONS, undefined);
    expect(answers.get("needContents_t1")).toBe(0.1);
    expect(captured?.url).toBe("http://openjev:8000");
    expect(captured?.headers.authorization).toBeUndefined();
  });

  it("retries once on HTTP 5xx when configured, then succeeds", async () => {
    let calls = 0;
    const fetcher: FetchLike = async () => {
      calls += 1;
      if (calls === 1)
        return { ok: false, status: 503, text: async () => "unavailable" };
      return okFetch({
        answers: {
          needContents_t1: { noul: 0.9 },
          needVerbatim_t1: { noul: 0.9 },
        },
      })("", {
        method: "POST",
        headers: {},
        body: "",
        signal: new AbortController().signal,
      });
    };
    const config = resolveJevCompactionConfig({ jev: { retries: 1 } });
    const backend = new SystemOneClient(config, fetcher);
    const answers = await withEnv("TYPESAFE_API_KEY", "k", () =>
      backend.score(STATE, QUESTIONS, undefined),
    );
    expect(calls).toBe(2);
    expect(answers.get("needVerbatim_t1")).toBe(0.9);
  });

  it("does not retry 4xx and surfaces a transport error", async () => {
    let calls = 0;
    const fetcher: FetchLike = async () => {
      calls += 1;
      return { ok: false, status: 401, text: async () => "unauthorized" };
    };
    const config = resolveJevCompactionConfig({ jev: { retries: 1 } });
    const backend = new SystemOneClient(config, fetcher);
    await expect(
      withEnv("TYPESAFE_API_KEY", "k", () =>
        backend.score(STATE, QUESTIONS, undefined),
      ),
    ).rejects.toThrow(JevTransportError);
    expect(calls).toBe(1);
  });

  it("honours caller cancellation", async () => {
    const controller = new AbortController();
    const fetcher: FetchLike = async (_url, init) => {
      controller.abort();
      init.signal.throwIfAborted();
      return okFetch({ answers: {} })("", init);
    };
    const backend = new SystemOneClient(
      resolveJevCompactionConfig({}),
      fetcher,
    );
    await expect(
      withEnv("TYPESAFE_API_KEY", "k", () =>
        backend.score(STATE, QUESTIONS, controller.signal),
      ),
    ).rejects.toThrow(JevTransportError);
  });
});
