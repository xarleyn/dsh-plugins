import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { IntegrationError } from "../../src/errors.js";
import {
  DEADLINE_IS_THE_BUDGET,
  fetchWithRetries,
  readBoundedJson,
  RESEND_AFTER_EVERY_FAULT,
  type FetchRetryPolicy,
  type ResponseRead,
} from "../../src/providers/kernel/read-policy.js";

/**
 * The budget of one attempt ends when its body does.
 *
 * `fetch()` resolves when the response headers arrive, so a loop that released
 * its deadline there let the upstream choose how long the call lasted: answer
 * `200 OK` and then dribble, and the read hung. The size cap could not save it
 * either — a server willing to send one byte a second stays inside any byte
 * budget while holding the call, and in service mode the rate-limiter slot
 * leased around it, open indefinitely.
 *
 * What the two named retry rules do not cover is that stall: an upstream that
 * answered is an answered request, and re-asking it is the provider's choice to
 * make about a request that never produced an answer, not about one whose body
 * this deployment gave up on reading.
 *
 * These cases run against a real server on a real socket rather than a
 * hand-built `Response`, because the thing under test is whether an abort
 * reaches a body still being read, and a stream nobody connected to the signal
 * would answer that question however the test wished.
 */

/** A server that answers headers and one partial chunk, then falls silent. */
async function stalledServer(
  onHit: () => void,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const sockets = new Set<import("node:net").Socket>();
  const server: Server = createServer((request, response) => {
    onHit();
    response.writeHead(200, { "content-type": "application/json" });
    // An opening that is not valid JSON: a read that returns this far has
    // already proved it did not wait for the whole body.
    response.write('{"a":');
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/trickle`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
}

/** A server that answers the whole body at once. */
async function answeringServer(
  body: string,
  onHit: () => void = () => {},
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    onHit();
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    });
    response.end(body);
  });
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/answer`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

/**
 * How long one attempt at a real socket is given.
 *
 * The budget is what the cases measure, so it cannot be the shortest delay that
 * happens to work on an idle machine: a loopback handshake and a two-packet
 * exchange that must fit inside it take a couple of milliseconds unloaded and
 * arbitrarily long under a loaded runner, and a case that loses that race
 * reddens without anything in the kernel regressing. The stall cases do not get
 * looser for it — a server that falls silent mid-body is silent forever, so any
 * budget still ends in `UpstreamTimeout` and `hits === 1` still means the
 * request reached the handler rather than never left.
 */
const SOCKET_BUDGET_MS = 1_000;

/** The budget of an attempt that never touches a socket (see `hanging`). */
const IN_MEMORY_BUDGET_MS = 60;

function policyOf(target: Partial<FetchRetryPolicy> = {}): FetchRetryPolicy {
  return {
    timeoutMs: SOCKET_BUDGET_MS,
    retries: 0,
    headers: {},
    transportFailure: (_error, timedOut) =>
      new IntegrationError(
        timedOut ? "UpstreamTimeout" : "ProviderUnavailable",
        timedOut ? "did not finish answering" : "did not answer",
      ),
    statusFailure: () =>
      new IntegrationError("ProviderUnavailable", "refused the request"),
    ...target,
  };
}

const readJson: ResponseRead<unknown> = (response, signal) =>
  readBoundedJson(response, 1_000_000, "test", signal);

describe("kernel read budget", () => {
  it("refuses an upstream that answers headers and then stalls the body", async () => {
    let hits = 0;
    const target = await stalledServer(() => {
      hits += 1;
    });
    try {
      await expect(
        fetchWithRetries(fetch, target.url, policyOf(), readJson),
      ).rejects.toMatchObject({ code: "UpstreamTimeout" });
      expect(hits).toBe(1);
    } finally {
      await target.close();
    }
  });

  it("does not re-send a stalled body when the deadline is the budget", async () => {
    let hits = 0;
    const target = await stalledServer(() => {
      hits += 1;
    });
    try {
      await expect(
        fetchWithRetries(
          fetch,
          target.url,
          policyOf({ retries: 2, retriable: DEADLINE_IS_THE_BUDGET }),
          readJson,
        ),
      ).rejects.toMatchObject({ code: "UpstreamTimeout" });
      expect(hits).toBe(1);
    } finally {
      await target.close();
    }
  });

  it("does not re-send a stalled body even where the provider re-sends faults", async () => {
    // The boundary the two rules share: a body this deployment stopped reading
    // is the read's own refusal, not a request that never answered, so the
    // longer budget does not buy it a second attempt either.
    let hits = 0;
    const target = await stalledServer(() => {
      hits += 1;
    });
    try {
      await expect(
        fetchWithRetries(
          fetch,
          target.url,
          policyOf({ retries: 1, retriable: RESEND_AFTER_EVERY_FAULT }),
          readJson,
        ),
      ).rejects.toMatchObject({ code: "UpstreamTimeout" });
      expect(hits).toBe(1);
    } finally {
      await target.close();
    }
  });

  it("re-sends a request that never answered where the deadline is re-paid", async () => {
    // What the deviation from the default actually buys: an upstream that never
    // got as far as a response is asked again, so one read can cost
    // `retries × timeoutMs` instead of the single `timeoutMs` the default caps.
    let attempts = 0;
    const hanging: typeof fetch = (_input, init) => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    };
    await expect(
      fetchWithRetries(
        hanging,
        "http://127.0.0.1:1/never-answers",
        policyOf({
          timeoutMs: IN_MEMORY_BUDGET_MS,
          retries: 1,
          retriable: RESEND_AFTER_EVERY_FAULT,
        }),
        readJson,
      ),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });
    expect(attempts).toBe(2);
  });

  it("reads a body that finishes in time without touching its own deadline", async () => {
    const target = await answeringServer('{"a":1}');
    try {
      await expect(
        fetchWithRetries(fetch, target.url, policyOf(), readJson),
      ).resolves.toEqual({ a: 1 });
    } finally {
      await target.close();
    }
  });

  it("keeps a consumer's own verdict out of the retry loop", async () => {
    // A truncated or unparsable body is an answer about the payload, not a
    // network fault: it must surface as the consumer said, and must not earn
    // another attempt from a provider that re-sends every transport fault.
    let hits = 0;
    const target = await answeringServer("not json at all", () => {
      hits += 1;
    });
    try {
      await expect(
        fetchWithRetries(
          fetch,
          target.url,
          policyOf({ retries: 3, retriable: RESEND_AFTER_EVERY_FAULT }),
          readJson,
        ),
      ).rejects.toMatchObject({ code: "ProviderUnavailable" });
      expect(hits).toBe(1);
    } finally {
      await target.close();
    }
  });
});
