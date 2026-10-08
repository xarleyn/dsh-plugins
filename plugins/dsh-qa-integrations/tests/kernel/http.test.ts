/**
 * The HTTP boundary every provider shares: the deployment's byte cap, the
 * deadline that holds the body stream as well as the headers, the prefix-keeping
 * truncation and the fold from a capped or unreadable body into a domain error.
 * Pinned once here because all seven transports route through it — a second copy
 * is what let one of them answer `ProviderUnavailable` for a body the other six
 * called `ResultTooLarge`.
 */
import { describe, expect, it } from "vitest";

import { IntegrationError } from "../../src/errors.js";
import {
  statusErrorOf,
  transportFailureOf,
} from "../../src/providers/kernel/errors.js";
import {
  fetchWithRetries,
  readBoundedJson,
  readBoundedText,
  type FetchRetryPolicy,
} from "../../src/providers/kernel/read-policy.js";

const JSON_HEADERS = { "content-type": "application/json" };

/** Where a test's upstream stands: a synthetic address, never a real one. */
const TARGET = "https://provider.example.test/rest";

/** No budget in these cases is raced by more than this much slack. */
const BUDGET_SLACK_MS = 1_000;

function upstream(
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/** An answer that stops delivering chunks after the headers. */
function stalled(stream: { cancelled: boolean }): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      cancel: () => {
        stream.cancelled = true;
      },
    }),
    { status: 200, headers: JSON_HEADERS },
  );
}

describe("readBoundedJson", () => {
  it("parses a body that is exactly the cap", async () => {
    const payload = JSON.stringify({ ID: "7" });
    await expect(
      readBoundedJson(
        upstream(payload),
        Buffer.byteLength(payload, "utf8"),
        "Provider",
        AbortSignal.timeout(30_000),
      ),
    ).resolves.toEqual({ ID: "7" });
  });

  it("folds a body over the cap into ResultTooLarge, in the transport's words", async () => {
    const payload = JSON.stringify({ ID: "7".repeat(64) });
    await expect(
      readBoundedJson(
        upstream(payload),
        32,
        "Confluence",
        AbortSignal.timeout(30_000),
      ),
    ).rejects.toMatchObject({
      code: "ResultTooLarge",
      message: "Confluence response is too large",
    });
  });

  it("treats a declared size over the cap as too large without reading the body", async () => {
    await expect(
      readBoundedJson(
        upstream('{"ID":"7"}', { "content-length": "4000000" }),
        8,
        "Provider",
        AbortSignal.timeout(30_000),
      ),
    ).rejects.toMatchObject({ code: "ResultTooLarge" });
  });

  it("folds a body that is not JSON into ProviderUnavailable", async () => {
    await expect(
      readBoundedJson(
        upstream("not json"),
        64,
        "Jira",
        AbortSignal.timeout(30_000),
      ),
    ).rejects.toMatchObject({
      code: "ProviderUnavailable",
      message: "Jira returned invalid JSON",
    });
  });

  it("never parses a body it classified as binary", async () => {
    const binary = new Response(new Uint8Array([0, 1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
    await expect(
      readBoundedJson(binary, 64, "Provider", AbortSignal.timeout(30_000)),
    ).rejects.toMatchObject({
      code: "ProviderUnavailable",
    });
  });
});

describe("readBoundedText", () => {
  const room = () => AbortSignal.timeout(30_000);

  it("keeps the prefix that fits and reports the body as truncated", async () => {
    const body = await readBoundedText(
      upstream("x".repeat(40)),
      16,
      "Provider",
      room(),
    );
    expect(body.truncated).toBe(true);
    expect(body.text).toBe("x".repeat(16));
    expect(body.binary).toBe(false);
  });

  it("hands a binary body back as metadata instead of text", async () => {
    const binary = new Response(new Uint8Array([0, 1, 2]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    const body = await readBoundedText(binary, 64, "Provider", room());
    expect(body).toMatchObject({ binary: true, text: "", truncated: false });
  });

  it("ends a body that never finishes arriving inside its own budget", async () => {
    // The fetch answered, so nothing in the read observes the deadline unless
    // the read is held to it: this is the case that used to stay pending.
    const stream = { cancelled: false };
    const startedAt = Date.now();
    await expect(
      readBoundedText(
        stalled(stream),
        1_000,
        "Provider",
        AbortSignal.timeout(20),
      ),
    ).rejects.toMatchObject({
      code: "UpstreamTimeout",
      message: "Provider did not finish sending its body",
    });
    expect(
      Date.now() - startedAt,
      "the deadline is what ended the read",
    ).toBeLessThan(BUDGET_SLACK_MS);
    expect(stream.cancelled, "the stalled stream is released").toBe(true);
  });

  it("refuses a read whose deadline passed before it started", async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = { cancelled: false };
    await expect(
      readBoundedText(stalled(stream), 1_000, "TeamCity", controller.signal),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });
    expect(stream.cancelled, "the abandoned stream is released").toBe(true);
  });

  it("folds a body that breaks mid-transfer into a transport failure", async () => {
    const broken = new Response(
      new ReadableStream<Uint8Array>({
        start: (source) => {
          source.error(new Error("socket hang up"));
        },
      }),
      { status: 200, headers: JSON_HEADERS },
    );
    await expect(
      readBoundedText(broken, 1_000, "Provider", room()),
    ).rejects.toThrow("socket hang up");
  });

  it("releases the stream once the cap has been reached", async () => {
    let cancelled = false;
    const body = new Response(
      new ReadableStream<Uint8Array>({
        start: (source) => {
          source.enqueue(new TextEncoder().encode("x".repeat(64)));
        },
        cancel: () => {
          cancelled = true;
        },
      }),
      { status: 200, headers: JSON_HEADERS },
    );
    const read = await readBoundedText(body, 8, "Provider", room());
    expect(read.text).toBe("x".repeat(8));
    expect(read.truncated).toBe(true);
    // The release is not awaited: a source that never delivers a chunk cannot
    // finish cancelling itself, so it lands a microtask later.
    await Promise.resolve();
    expect(cancelled, "a capped body does not keep the connection open").toBe(
      true,
    );
  });
});

describe("fetchWithRetries", () => {
  const policy = (timeoutMs: number, retries: number): FetchRetryPolicy => ({
    timeoutMs,
    retries,
    headers: { accept: "application/json" },
    transportFailure: (_error, timedOut) =>
      new IntegrationError(
        timedOut ? "UpstreamTimeout" : "ProviderUnavailable",
        "Provider request failed",
      ),
    retriable: () => true,
    statusFailure: () => new IntegrationError("ResourceNotFound", "gone"),
  });

  it("holds the attempt budget over the read it hands the response to", async () => {
    // Clearing the timer once the headers arrived is the defect: the body is
    // read after that point, so it had to keep its own deadline.
    const stream = { cancelled: false };
    const fetcher: typeof fetch = async () => stalled(stream);
    const startedAt = Date.now();
    await expect(
      fetchWithRetries(fetcher, TARGET, policy(20, 2), (response, signal) =>
        readBoundedText(response, 1_000, "Provider", signal),
      ),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });
    expect(
      Date.now() - startedAt,
      "one attempt is the whole budget",
    ).toBeLessThan(BUDGET_SLACK_MS);
    expect(stream.cancelled, "the stalled stream is released").toBe(true);
  });

  it("does not re-send a fetch that answered", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return stalled({ cancelled: false });
    };
    await expect(
      fetchWithRetries(fetcher, TARGET, policy(20, 2), (response, signal) =>
        readBoundedText(response, 1_000, "Provider", signal),
      ),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });
    expect(attempts, "a stalled body is not a reason to ask twice").toBe(1);
  });

  it("leaves a domain answer of the read out of the transport folding", async () => {
    // A body over the cap is the provider's own refusal, not a transport fault:
    // the loop must not turn it into a retry or into an unreachable upstream.
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return upstream(JSON.stringify({ ID: "7".repeat(64) }));
    };
    await expect(
      fetchWithRetries(fetcher, TARGET, policy(1_000, 2), (response, signal) =>
        readBoundedJson(response, 16, "Weblate", signal),
      ),
    ).rejects.toMatchObject({
      code: "ResultTooLarge",
      message: "Weblate response is too large",
    });
    expect(attempts).toBe(1);
  });

  it("reads an answer that arrives whole and retries what never answered", async () => {
    let attempts = 0;
    const hanging: typeof fetch = (_input, init) => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    };
    await expect(
      fetchWithRetries(hanging, TARGET, policy(20, 1), () =>
        Promise.reject(new Error("the read is never reached")),
      ),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });
    expect(attempts, "a host that never answers is asked again").toBe(2);

    attempts = 0;
    const answering: typeof fetch = async () => {
      attempts += 1;
      return upstream('{"ID":"7"}');
    };
    await expect(
      fetchWithRetries(
        answering,
        TARGET,
        policy(1_000, 2),
        (response, signal) =>
          readBoundedJson<{ ID: string }>(response, 64, "Provider", signal),
      ),
    ).resolves.toEqual({ ID: "7" });
    expect(attempts).toBe(1);
  });
});

/**
 * A spent personal key on a Jira Data Center or a TeamCity is not answered with
 * a 401: the upstream sends the caller to its sign-in page. The loop used to
 * refuse that answer at the socket (`redirect: "error"`), so the fetch raised an
 * opaque failure and every transport folded it into one phrase — "request
 * failed" — shared with a host that is down, with no action in it and nothing
 * written back about the connection. The answer is now read as the answer it
 * is, and it says what the user can do.
 */
describe("a refused credential", () => {
  const credentialPolicy: FetchRetryPolicy = {
    timeoutMs: 1_000,
    retries: 2,
    headers: { accept: "application/json" },
    transportFailure: transportFailureOf({ label: "Jira" }),
    statusFailure: statusErrorOf({ label: "Jira" }),
  };

  const readJson = (response: Response, signal: AbortSignal) =>
    readBoundedJson<unknown>(response, 100_000, "Jira", signal);

  function signInRedirect(): Response {
    return new Response("<!doctype html><html><body>Sign in</body></html>", {
      status: 302,
      headers: {
        location: "https://jira.example.test/login.jsp",
        "content-type": "text/html; charset=utf-8",
      },
    });
  }

  it("reads a redirect as the provider's own answer instead of a socket failure", async () => {
    const inits: RequestInit[] = [];
    let reads = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      inits.push(init ?? {});
      return signInRedirect();
    };
    await expect(
      fetchWithRetries(
        fetcher,
        TARGET,
        credentialPolicy,
        (response, signal) => {
          reads += 1;
          return readJson(response, signal);
        },
      ),
    ).rejects.toMatchObject({
      code: "CredentialRevoked",
      message:
        "Jira redirected to a sign-in page instead of answering; reconnect the integration",
    });
    // Never followed, so the credential stays with its own origin — but handed
    // back rather than raised, which is what lets the fold name the reason.
    expect(inits[0]?.redirect).toBe("manual");
    expect(reads, "a refused answer is not read").toBe(0);
  });

  it("asks once, because asking again answers the same way", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return signInRedirect();
    };
    await expect(
      fetchWithRetries(fetcher, TARGET, credentialPolicy, readJson),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
    expect(attempts).toBe(1);
  });

  it("folds a sign-in page that arrived under a 200 the same way", async () => {
    const fetcher: typeof fetch = async () =>
      new Response("<html><head><title>Sign in</title></head></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    await expect(
      fetchWithRetries(fetcher, TARGET, credentialPolicy, readJson),
    ).rejects.toMatchObject({
      code: "CredentialRevoked",
      message:
        "Jira answered with a sign-in page instead of data; reconnect the integration",
    });
  });

  it("names the answer's shape on the failure that carries it out", async () => {
    // The broker reports the refusal and never held the response; these three
    // fields are what turns "Jira request failed" back into a diagnosis.
    const redirected = await fetchWithRetries(
      async () => signInRedirect(),
      TARGET,
      credentialPolicy,
      readJson,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((redirected as IntegrationError).diagnostics).toMatchObject({
      status: 302,
      contentType: "text/html; charset=utf-8",
    });

    const refused = await fetchWithRetries(
      async () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
        });
      },
      TARGET,
      { ...credentialPolicy, retries: 0 },
      readJson,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((refused as IntegrationError).diagnostics).toMatchObject({
      errorClass: "ECONNREFUSED",
    });
    expect((refused as IntegrationError).diagnostics?.status).toBeUndefined();
  });

  it("keeps an answer's body, address and secret out of the diagnostics", async () => {
    const error = await fetchWithRetries(
      async () =>
        new Response(`<html>${"secret-token-value".padEnd(900, "x")}</html>`, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      TARGET,
      credentialPolicy,
      readJson,
    ).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    const line = JSON.stringify((error as IntegrationError).diagnostics ?? {});
    expect(line).not.toContain("secret-token-value");
    expect(line).not.toContain("example.test");
    expect(line).not.toMatch(/https?:\/\//u);
  });
});
