/**
 * The account-scoped fallback for the model-facing memory tools (the recall
 * half of the 2026-10-28 wave acceptance, lane L05: a confirmed write the
 * model's own `mcp openviking search` could not see).
 *
 * The bridged MCP tools answer through one deployment-identity proxy, while
 * the runtime's own reads and writes are account-scoped, so an empty upstream
 * answer is a fact about the deployment space, not about the account's
 * memory. The fallback re-reads the same query through the asking session's
 * own client — the assertions below are all at the transport layer: which
 * header the re-read carried, and what the model was handed instead of
 * "no matches".
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  createFakeAgent,
  createHarness,
  emit,
  type Harness,
} from "./helpers/harness.js";
import { ok, transport } from "./runtime.helpers.js";
import {
  isMemorySearchTool,
  memoryToolQueryOf,
  resultCarriesMemoryHits,
} from "../src/qa/search-fallback.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/** The seeded memory, visible only inside its owner's space. */
const SEED_URI = "viking://user/u1/memories/seed";
const SEED_RENDERED = `<doc uri="${SEED_URI}">квантовый гусь</doc>`;

/** A QA surface that attributes exactly the sessions a test names. */
function surfaceFor(owners: Record<string, string>) {
  return {
    principalForSession: (sessionId: string) => {
      const userId = owners[sessionId];
      return userId === undefined ? undefined : { userId };
    },
    principalForToken: () => undefined,
  };
}

/**
 * The deployment the lane ran: writes land in the account's space, and the
 * deployment-identity proxy reads a space where they do not exist.
 */
function scopedWorld() {
  return createHarness(
    {},
    {
      qaSurface: surfaceFor({ "dsh-u1": "u1", "dsh-other": "other" }),
      fetchImpl: transport({
        "/api/v1/search/search": (init) =>
          ok(
            (init?.headers as Record<string, string>)?.["X-OpenViking-User"] ===
            "u1"
              ? { rendered: SEED_RENDERED, entries: [], digest: "", stats: {} }
              : { rendered: "", entries: [], digest: "", stats: {} },
          ),
      }),
    },
  );
}

/** One model-directed retrieval call with the bridge's tool naming. */
function searchExec(sessionId: string, query = "квантовый гусь") {
  const { agent } = createFakeAgent({ sessionId });
  return {
    agent,
    exec: {
      callId: "call-1",
      name: "mcp__openviking__search",
      arguments: { query },
      agent,
      signal: new AbortController().signal,
    },
  };
}

/** The upstream answer the unscoped proxy returns for the seed. */
const upstreamEmpty = {
  isError: false,
  content: [{ type: "text", text: "no matches" }],
};

function nextAccepts(): Promise<{
  kind: "accept";
  content: { type: string; text: string }[];
}> {
  return Promise.resolve({
    kind: "accept",
    content: [{ type: "text", text: "no matches" }],
  });
}

describe("account-scoped memory search fallback", () => {
  it("re-reads an empty upstream answer through the owning account's space", async () => {
    harness = await scopedWorld();
    const { exec } = searchExec("dsh-u1");

    const decision = (await emit(
      harness,
      "tools/post-execute",
      exec,
      upstreamEmpty,
      nextAccepts,
    )) as { kind: string; content?: { type: string; text: string }[] };

    expect(decision.kind).toBe("accept");
    const text = decision.content?.[0]?.text ?? "";
    expect(text).toContain("viking://");
    expect(text).toContain("квантовый гусь");
    // The re-read spoke as the asking account, not as the deployment.
    const searches = harness.requestsFor("/api/v1/search/search");
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.at(-1)?.headers["X-OpenViking-User"]).toBe("u1");
  });

  it("keeps an upstream answer that already names memory", async () => {
    harness = await scopedWorld();
    const { exec } = searchExec("dsh-u1");
    const upstreamHit = {
      isError: false,
      content: [{ type: "text", text: `hit at ${SEED_URI}` }],
    };

    const decision = (await emit(
      harness,
      "tools/post-execute",
      exec,
      upstreamHit,
      () =>
        Promise.resolve({
          kind: "accept",
          content: [{ type: "text", text: `hit at ${SEED_URI}` }],
        }),
    )) as { kind: string; content?: { type: string; text: string }[] };

    expect(decision.content?.[0]?.text).toContain("hit at");
    expect(harness.countRequests("/api/v1/search/search")).toBe(0);
  });

  it("leaves an unattributed session's answer alone", async () => {
    harness = await scopedWorld();
    const { exec } = searchExec("dsh-nobody");

    const decision = (await emit(
      harness,
      "tools/post-execute",
      exec,
      upstreamEmpty,
      nextAccepts,
    )) as { kind: string; content?: { type: string; text: string }[] };

    expect(decision.content?.[0]?.text).toBe("no matches");
    expect(harness.countRequests("/api/v1/search/search")).toBe(0);
  });

  it("leaves every other tool's answer alone", async () => {
    harness = await scopedWorld();
    const { agent } = createFakeAgent({ sessionId: "dsh-u1" });

    const decision = (await emit(
      harness,
      "tools/post-execute",
      {
        callId: "call-2",
        name: "mcp__openviking__read",
        arguments: { uris: SEED_URI },
        agent,
        signal: new AbortController().signal,
      },
      upstreamEmpty,
      nextAccepts,
    )) as { kind: string; content?: { type: string; text: string }[] };

    expect(decision.content?.[0]?.text).toBe("no matches");
    expect(harness.countRequests("/api/v1/search/search")).toBe(0);
  });

  it("keeps a failed upstream call failed", async () => {
    harness = await scopedWorld();
    const { exec } = searchExec("dsh-u1");

    const decision = (await emit(
      harness,
      "tools/post-execute",
      exec,
      { isError: true, content: [{ type: "text", text: "HTTP 503" }] },
      () =>
        Promise.resolve({
          kind: "accept",
          content: [{ type: "text", text: "HTTP 503" }],
        }),
    )) as { kind: string; content?: { type: string; text: string }[] };

    expect(decision.content?.[0]?.text).toBe("HTTP 503");
    expect(harness.countRequests("/api/v1/search/search")).toBe(0);
  });
});

describe("memory search tool contract", () => {
  it("names the bridged retrieval tools and reads their query argument", () => {
    expect(isMemorySearchTool("mcp__openviking__search")).toBe(true);
    expect(isMemorySearchTool("mcp__openviking__find")).toBe(true);
    expect(isMemorySearchTool("mcp__openviking__grep")).toBe(true);
    expect(isMemorySearchTool("mcp__openviking__read")).toBe(false);
    expect(memoryToolQueryOf("mcp__openviking__search", { query: " x " })).toBe(
      "x",
    );
    expect(memoryToolQueryOf("mcp__openviking__grep", { pattern: "p" })).toBe(
      "p",
    );
    expect(memoryToolQueryOf("mcp__openviking__search", { query: "   " })).toBe(
      null,
    );
    expect(memoryToolQueryOf("mcp__openviking__read", {})).toBe(null);
  });

  it("reads an answer without a viking URI as empty, and an error as final", () => {
    expect(
      resultCarriesMemoryHits({
        isError: false,
        content: [{ type: "text", text: "no matches" }],
      }),
    ).toBe(false);
    expect(
      resultCarriesMemoryHits({
        isError: false,
        content: [{ type: "text", text: `found ${SEED_URI}` }],
      }),
    ).toBe(true);
    expect(
      resultCarriesMemoryHits({
        isError: true,
        content: [{ type: "text", text: "HTTP 503" }],
      }),
    ).toBe(true);
  });
});
