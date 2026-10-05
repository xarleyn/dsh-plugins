import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { IntegrationBroker } from "../../src/broker.js";
import type { IntegrationProvider } from "../../src/providers/contract.js";
import {
  statusErrorOf,
  transportFailureOf,
} from "../../src/providers/kernel/errors.js";
import {
  fetchWithRetries,
  readBoundedJson,
  RESEND_AFTER_EVERY_FAULT,
} from "../../src/providers/kernel/read-policy.js";
import { IntegrationProviderRegistry } from "../../src/providers/registry.js";
import { IntegrationRepository } from "../../src/repository.js";
import { MemoryKeyProvider } from "../../src/secrets/key-provider.js";
import { SecretStore } from "../../src/secrets/secret-store.js";
import type { IntegrationPrincipal } from "../../src/types.js";

/**
 * A provider that stops answering costs the operator an answer they never got,
 * and the log used to say nothing about it: the audit trail recorded `error`,
 * the chat recorded a reason code, and `grep timeout` over this plugin's own log
 * file came back empty.
 *
 * The failures here are produced by the real transport loop rather than thrown
 * by hand, so what the broker logs is what that loop actually leaves behind —
 * the deadline it armed, the retries it allowed and the attempts it spent. A
 * fold that stops naming them reddens this suite instead of going invisible on
 * a stand again.
 */

/** What the made-up upstream meets a request with. */
type Upstream =
  /** Answers the headers and a whole body. */
  | "answering"
  /** Never answers at all: the deadline ends the attempt. */
  | "silent"
  /** Answers the headers and then stops delivering the body. */
  | "stalled"
  /** Refuses the connection: an unreachable host, not an expired deadline. */
  | "gone";

/** The state a case flips between its own steps. */
interface UpstreamState {
  /** What a tool call's read meets. */
  mode: Upstream;
  /** What the credential probe meets, so a connect can be made to stand. */
  probe: Upstream;
}

/** The per-attempt deadline the loop is held to, and its retry allowance. */
const TIMEOUT_MS = 20;
const RETRIES = 1;

/** The address and the query a logged failure must never carry. */
const HOST = "acme.example";
const QUERY_VALUE = "secret-filter-value";

/** The secret a logged failure must never carry either. */
const TOKEN = "alice-upstream-token";

/** Where the read goes: an address no test fetcher ever dials. */
const TARGET = `https://${HOST}/records?filter=${QUERY_VALUE}`;

function upstreamFetcher(mode: Upstream): typeof fetch {
  if (mode === "answering") {
    return async () =>
      new Response('{"items":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
  }
  if (mode === "gone") {
    return async () => {
      throw new TypeError("fetch failed");
    };
  }
  if (mode === "stalled") {
    // The half the budget has to reach: a response that arrives and then stops
    // delivering chunks, which nothing but the deadline can end.
    return async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(new TextEncoder().encode('{"items":'));
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
  }
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("This operation was aborted", "AbortError")),
      );
    });
}

/**
 * A provider whose reads — the probe and the call alike — go through
 * `fetchWithRetries`, so the folded failure the broker sees is the one the
 * kernel produces.
 */
function upstreamProvider(state: UpstreamState): IntegrationProvider {
  const read = (mode: Upstream) =>
    fetchWithRetries(
      upstreamFetcher(mode),
      TARGET,
      {
        timeoutMs: TIMEOUT_MS,
        retries: RETRIES,
        headers: { authorization: `Bearer ${TOKEN}` },
        transportFailure: transportFailureOf({ label: "Acme" }),
        retriable: RESEND_AFTER_EVERY_FAULT,
        statusFailure: statusErrorOf({ label: "Acme" }),
      },
      (response, signal) =>
        readBoundedJson<unknown>(response, 1_000_000, "Acme", signal),
    );
  return {
    id: "acme",
    displayName: "Acme",
    capabilities: ["records.read"],
    capabilityInfo: {
      "records.read": { label: "Читать записи", hint: "Acme records hint" },
    },
    credentialHelp: null,
    operationCapability: () => "records.read",
    parseCredential: (raw) => ({
      credential: JSON.stringify({ token: raw }),
      portal: HOST,
    }),
    validate: async () => {
      await read(state.probe);
      return {
        tenantId: HOST,
        externalUserId: "11",
        displayName: "Alice",
        capabilities: ["records.read"],
      };
    },
    execute: async () => await read(state.mode),
  };
}

/** One logged record, both halves of it: the event and its fields. */
interface Recorded {
  readonly event: string;
  readonly fields: Record<string, unknown> | undefined;
}

type RecordingLogger = PluginLogger & { readonly records: Recorded[] };

function recordingLogger(): RecordingLogger {
  const records: Recorded[] = [];
  const logger = {
    records,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (event: string, fields?: Record<string, unknown>): void => {
      records.push({ event, fields });
    },
    error: () => undefined,
    fatal: () => undefined,
    child: () => logger,
    close: async () => undefined,
  };
  return logger as unknown as RecordingLogger;
}

/** The warnings of one event name, in the order they were logged. */
function events(logger: RecordingLogger, event: string): Recorded[] {
  return logger.records.filter((entry) => entry.event === event);
}

interface Harness {
  readonly broker: IntegrationBroker;
  readonly logger: RecordingLogger;
  readonly principal: IntegrationPrincipal;
  readonly state: UpstreamState;
}

const repositories: IntegrationRepository[] = [];

function buildHarness(root: string, name: string): Harness {
  const state: UpstreamState = { mode: "silent", probe: "answering" };
  const providers = new IntegrationProviderRegistry();
  providers.register(upstreamProvider(state));
  const logger = recordingLogger();
  const repository = new IntegrationRepository(path.join(root, `${name}.db`));
  repositories.push(repository);
  return {
    broker: new IntegrationBroker(
      repository,
      new SecretStore(
        new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
      ),
      providers,
      logger,
    ),
    logger,
    principal: { userId: `alice-${name}` },
    state,
  };
}

describe("broker transport timeout log", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qa-integrations-timeout-"));
  afterAll(() => {
    // The store holds its SQLite handle open, and Windows will not delete a
    // file a process still has.
    for (const repository of repositories) repository.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("names the deadline and the attempts when a call is never answered", async () => {
    const { broker, logger, principal } = buildHarness(root, "silent");
    await broker.connect(principal, "acme", { token: TOKEN });

    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "records.list",
        input: {},
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });

    const warnings = events(logger, "transport.timeout");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fields).toMatchObject({
      provider: "acme",
      operation: "records.list",
      timeoutMs: TIMEOUT_MS,
      retries: RETRIES,
      // The retry allowance spent to the last attempt: this is what tells an
      // operator whether one deadline ended the call or several did.
      attempts: RETRIES + 1,
    });
  });

  it("keeps the secret, the address and the query out of the warning", async () => {
    const { broker, logger, principal } = buildHarness(root, "leak");
    await broker.connect(principal, "acme", { token: TOKEN });
    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "records.list",
        input: {},
        sourceSessionId: "s-leak",
      }),
    ).rejects.toBeInstanceOf(Error);

    const warnings = events(logger, "transport.timeout");
    expect(warnings).toHaveLength(1);
    const line = JSON.stringify(warnings[0]?.fields ?? {});
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain(HOST);
    expect(line).not.toContain(QUERY_VALUE);
    expect(line).not.toMatch(/https?:\/\//u);
  });

  it("counts one attempt when the body was this deployment's own read to give up on", async () => {
    // The stalled half of the same budget: the headers arrived, so the loop does
    // not re-send — and the attempt count has to say one, not the retry
    // allowance, or the log would price a wait that never happened.
    const { broker, logger, principal, state } = buildHarness(root, "stalled");
    state.mode = "stalled";
    await broker.connect(principal, "acme", { token: TOKEN });

    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "records.get",
        input: { id: 9 },
        sourceSessionId: "s2",
      }),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });

    expect(events(logger, "transport.timeout").at(-1)?.fields).toMatchObject({
      provider: "acme",
      operation: "records.get",
      timeoutMs: TIMEOUT_MS,
      attempts: 1,
    });
  });

  it("stays quiet when the upstream refused the connection outright", async () => {
    // An unreachable host is a different diagnosis and gets a different record;
    // a timeout warning for it would claim a deadline ended something that
    // never reached one.
    const { broker, logger, principal, state } = buildHarness(root, "gone");
    state.mode = "gone";
    await broker.connect(principal, "acme", { token: TOKEN });

    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "records.list",
        input: {},
        sourceSessionId: "s3",
      }),
    ).rejects.toMatchObject({ code: "ProviderUnavailable" });
    expect(events(logger, "transport.timeout")).toHaveLength(0);
  });

  it("warns on a credential probe the upstream never answered", async () => {
    // The same invisible failure on the path the card walks. Nothing else here
    // tells the operator why the row went to `error`.
    const { broker, logger, principal, state } = buildHarness(root, "validate");
    await broker.connect(principal, "acme", { token: TOKEN });
    state.probe = "silent";

    await expect(broker.validate(principal, "acme")).rejects.toMatchObject({
      code: "UpstreamTimeout",
    });
    expect(events(logger, "transport.timeout")).toHaveLength(1);
    expect(events(logger, "transport.timeout")[0]?.fields).toMatchObject({
      provider: "acme",
      operation: "credential.validate",
      timeoutMs: TIMEOUT_MS,
    });
  });
});
