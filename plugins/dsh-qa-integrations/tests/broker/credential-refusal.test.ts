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
} from "../../src/providers/kernel/read-policy.js";
import { IntegrationProviderRegistry } from "../../src/providers/registry.js";
import { IntegrationRepository } from "../../src/repository.js";
import { MemoryKeyProvider } from "../../src/secrets/key-provider.js";
import { SecretStore } from "../../src/secrets/secret-store.js";
import type { IntegrationPrincipal } from "../../src/types.js";

/**
 * What a working call learns about its own credential.
 *
 * The verdict used to be written only by `validate`, which runs when somebody
 * opens the connect form. A personal key that died between two visits therefore
 * kept the row reading `connected` with an empty `last_error_code` while every
 * answer from that provider failed, and the plugin's log carried not one line
 * about it — the audit row said `error` and the reason lived only in the chat.
 */

/** What the made-up upstream answers. */
type Upstream =
  /** Data, as a healthy connection returns. */
  | "answering"
  /** A sign-in redirect: what a spent key on a Data Center looks like. */
  | "redirect"
  /** A login page under a 200. */
  | "page"
  /** Throttling, which is about the upstream's load and not the credential. */
  | "throttled"
  /** Refuses the connection: a host that is not there. */
  | "gone";

const TIMEOUT_MS = 1_000;
const HOST = "acme.example";
const TOKEN = "alice-upstream-token";
const TARGET = `https://${HOST}/records?filter=secret-filter-value`;
const SIGN_IN =
  "<!doctype html><html><body>Sign in " + TOKEN + "</body></html>";

function upstreamAnswer(mode: Upstream): Response {
  if (mode === "answering") {
    return new Response('{"items":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (mode === "gone") {
    throw Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connection refused"), {
        code: "ECONNREFUSED",
      }),
    });
  }
  const status = mode === "redirect" ? 302 : mode === "throttled" ? 429 : 200;
  return new Response(SIGN_IN, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(mode === "redirect" ? { location: `https://${HOST}/login` } : {}),
    },
  });
}

function upstreamProvider(state: { mode: Upstream }): IntegrationProvider {
  const read = () =>
    fetchWithRetries(
      async () => upstreamAnswer(state.mode),
      TARGET,
      {
        timeoutMs: TIMEOUT_MS,
        retries: 0,
        headers: { authorization: `Bearer ${TOKEN}` },
        transportFailure: transportFailureOf({ label: "Acme" }),
        statusFailure: statusErrorOf({ label: "Acme" }),
      },
      (response, signal) =>
        readBoundedJson<unknown>(response, 100_000, "Acme", signal),
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
      await read();
      return {
        tenantId: HOST,
        externalUserId: "11",
        displayName: "Alice",
        capabilities: ["records.read"],
      };
    },
    execute: async () => await read(),
  };
}

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

function events(logger: RecordingLogger, event: string): Recorded[] {
  return logger.records.filter((entry) => entry.event === event);
}

const repositories: IntegrationRepository[] = [];

interface Harness {
  readonly broker: IntegrationBroker;
  readonly logger: RecordingLogger;
  readonly principal: IntegrationPrincipal;
  readonly state: { mode: Upstream };
}

function buildHarness(root: string, name: string): Harness {
  // A connect that starts healthy: the defect this file is about is a key that
  // dies later, and only a row written `connected` can lie about it.
  const state = { mode: "answering" as Upstream };
  const providers = new IntegrationProviderRegistry();
  providers.register(upstreamProvider(state));
  const logger = recordingLogger();
  const repository = new IntegrationRepository(path.join(root, `${name}.db`));
  repositories.push(repository);
  const principal: IntegrationPrincipal = { userId: `alice-${name}` };
  const broker = new IntegrationBroker(
    repository,
    new SecretStore(new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1)),
    providers,
    logger,
  );
  return { broker, logger, principal, state };
}

async function refusalOf(
  harness: Harness,
  operation = "records.list",
): Promise<unknown> {
  return await harness.broker
    .call(harness.principal, {
      provider: "acme",
      operation,
      input: {},
      sourceSessionId: "s-refused",
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

describe("broker credential refusal", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qa-integrations-refusal-"));
  afterAll(() => {
    for (const repository of repositories) repository.close();
    rmSync(root, { recursive: true, force: true });
  });

  /** A connected binding whose upstream has started answering badly. */
  async function connected(name: string, mode: Upstream): Promise<Harness> {
    const harness = buildHarness(root, name);
    await harness.broker.connect(harness.principal, "acme", { token: TOKEN });
    harness.state.mode = mode;
    return harness;
  }

  it("writes the refusal back onto the connection the card reads", async () => {
    const harness = await connected("row", "redirect");
    expect(await refusalOf(harness)).toMatchObject({
      code: "CredentialRevoked",
    });
    expect(
      harness.broker.summary(harness.principal, "acme"),
      "the row must stop claiming a working connection",
    ).toMatchObject({
      status: "error",
      errorCode: "CredentialRevoked",
    });
  });

  it("clears the verdict once the same credential answers again", async () => {
    const harness = await connected("heal", "redirect");
    await refusalOf(harness);
    expect(harness.broker.summary(harness.principal, "acme").status).toBe(
      "error",
    );
    harness.state.mode = "answering";
    await expect(
      harness.broker.call(harness.principal, {
        provider: "acme",
        operation: "records.list",
        input: {},
        sourceSessionId: "s-healed",
      }),
    ).resolves.toBeDefined();
    expect(harness.broker.summary(harness.principal, "acme")).toMatchObject({
      status: "connected",
      errorCode: null,
    });
  });

  it("leaves the row alone when the answer says nothing about the credential", async () => {
    // A host that is down and a rate limit are the upstream's condition; a red
    // card would send the user to reconnect the token that was never the issue.
    for (const mode of ["gone", "throttled"] as const) {
      const harness = await connected(`keep-${mode}`, mode);
      await refusalOf(harness);
      expect(harness.broker.summary(harness.principal, "acme"), mode).toEqual(
        expect.objectContaining({ status: "connected", errorCode: null }),
      );
    }
  });

  it("logs what the answer looked like", async () => {
    const harness = await connected("log", "redirect");
    await refusalOf(harness, "records.get");
    const warnings = events(harness.logger, "tool.call-failed");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fields).toMatchObject({
      provider: "acme",
      operation: "records.get",
      reason: "CredentialRevoked",
      credentialSource: "personal",
      status: 302,
      contentType: "text/html; charset=utf-8",
    });
  });

  it("names the class of a transport failure that never got an answer", async () => {
    const harness = await connected("class", "gone");
    await refusalOf(harness);
    const warnings = events(harness.logger, "tool.call-failed");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fields).toMatchObject({
      reason: "ProviderUnavailable",
      errorClass: "ECONNREFUSED",
    });
    expect(warnings[0]?.fields?.status).toBeUndefined();
  });

  it("keeps the body, the address and the credential out of the line", async () => {
    const harness = await connected("leak", "page");
    await refusalOf(harness);
    const line = JSON.stringify(
      events(harness.logger, "tool.call-failed").map((entry) => entry.fields),
    );
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain(HOST);
    expect(line).not.toContain("secret-filter-value");
    expect(line).not.toMatch(/https?:\/\//u);
    expect(events(harness.logger, "tool.call-failed")[0]?.fields).toMatchObject(
      { reason: "CredentialRevoked", status: 200 },
    );
  });

  it("says nothing where the call was refused before it reached upstream", async () => {
    // A policy switch and a missing connection are decided here, and the audit
    // trail already names them; a line about an upstream answer would be false.
    const harness = await connected("quiet", "answering");
    harness.broker.patchPolicy(harness.principal, "acme", {
      operation: "records.read",
      mode: "deny",
    });
    expect(await refusalOf(harness)).toMatchObject({
      code: "OperationDeniedByPolicy",
    });
    expect(events(harness.logger, "tool.call-failed")).toHaveLength(0);
    expect(harness.broker.summary(harness.principal, "acme").status).toBe(
      "connected",
    );
  });
});
