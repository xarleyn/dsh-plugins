import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import type { QaAccounts } from "../../src/accounts/store.js";
import {
  QaIntegrationAttachmentError,
  QaIntegrationError,
} from "../../src/integration/contract.js";
import type {
  QaAskRequest,
  QaIntegrationRunner,
  QaIntegrationTurn,
} from "../../src/integration/contract.js";
import { QaIntegrationService } from "../../src/integration/service.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type { QaSourceReference } from "../../src/provenance/types.js";
import { store } from "../accounts/accounts.helpers.js";

/**
 * The integration service: who may ask, how often, how many at once, and what
 * an answered turn becomes on the wire. The runner is faked — sessions and
 * agents are the harness's business, and every refusal below has to hold
 * before a session is ever opened.
 */

const QUESTION: QaAskRequest = Object.freeze({
  message: "Что нового в версии 3.8?",
  version: "3.8",
  sessionId: null,
  context: Object.freeze({
    ticketKey: "PROJ-123",
    reporter: "user@example.corp",
    reporterName: "Иван Иванов",
  }),
  attachments: Object.freeze([]),
});

function source(index: number): QaSourceReference {
  return {
    id: `src-${String(index)}`,
    kind: "document",
    title: `Документация_v3.8-${String(index)}.pdf`,
    uri: `doc-${String(index)}.pdf`,
    locations: [{ anchor: "стр.12" }],
    evidence: "documented",
    origins: [{ sessionId: "session-1", turn: 1 }],
    score: 1,
  } as unknown as QaSourceReference;
}

function turn(overrides: Partial<QaIntegrationTurn> = {}): QaIntegrationTurn {
  return {
    chatId: "session-1",
    answer: "**Ответ**\n\nТекст ответа.",
    sources: [source(1)],
    interrupted: false,
    ...overrides,
  };
}

function logger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    close() {},
  } as never;
}

function service(options: {
  readonly accounts: QaAccounts | undefined;
  readonly runner: QaIntegrationRunner;
  readonly integration?: Record<string, unknown>;
  readonly accountsEnabled?: boolean;
  readonly now?: () => number;
}) {
  const config = resolveConfig({
    accounts: { enabled: options.accountsEnabled ?? true },
    integration: { enabled: true, ...options.integration },
  });
  return new QaIntegrationService({
    getConfig: () => config,
    accounts: () => options.accounts,
    runner: options.runner,
    logger: logger(),
    version: "0.10.0",
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

function quietRunner(
  run: QaIntegrationRunner["run"],
  transcript?: QaIntegrationRunner["transcript"],
  models?: QaIntegrationRunner["models"],
): QaIntegrationRunner {
  return {
    run,
    models: models ?? (async () => []),
    transcript:
      transcript ??
      (async (input) => ({
        chatId: input.chatId,
        messages: [],
        lastSeq: input.after,
        truncated: false,
      })),
  };
}

describe("integration service credentials", () => {
  let accounts: QaAccounts;
  let token: string;

  beforeEach(() => {
    accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    token = accounts.mintServiceToken(admin.token, { scopes: ["ask"] }).token;
  });

  it("refuses a missing, malformed or unknown credential as one answer", async () => {
    const asked = vi.fn();
    const api = service({ accounts, runner: quietRunner(asked) });
    const signal = new AbortController().signal;
    for (const header of [
      undefined,
      "",
      "qsat.abc.def",
      "Bearer",
      "Bearer v1.payload.signature",
      "Basic qsat.x.y",
      "Bearer qsat.00000000-0000-4000-8000-000000000000.whatever",
    ]) {
      await expect(api.ask(header, QUESTION, signal)).rejects.toMatchObject({
        reason: "unauthorized",
      });
    }
    expect(asked).not.toHaveBeenCalled();
  });

  it("refuses a valid token that lacks the ask scope", async () => {
    const admin = accounts.login("op@example.com", "password-1");
    const readOnly = accounts.mintServiceToken(admin.token, {
      scopes: ["sessions:read"],
    });
    const api = service({ accounts, runner: quietRunner(vi.fn()) });
    await expect(
      api.ask(
        `Bearer ${readOnly.token}`,
        QUESTION,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ reason: "forbidden", status: 403 });
    // Health needs a credential but no particular scope: it reports on the
    // deployment, not on a conversation.
    await expect(api.health(`Bearer ${readOnly.token}`)).resolves.toMatchObject(
      {
        ok: true,
      },
    );
  });

  it("refuses when the deployment has no accounts or has the API off", async () => {
    const noAccounts = service({
      accounts: undefined,
      runner: quietRunner(vi.fn()),
    });
    await expect(
      noAccounts.ask(`Bearer ${token}`, QUESTION, new AbortController().signal),
    ).rejects.toMatchObject({ reason: "unavailable", status: 503 });

    const off = new QaIntegrationService({
      getConfig: () =>
        resolveConfig({
          accounts: { enabled: true },
          integration: { enabled: false },
        }),
      accounts: () => accounts,
      runner: quietRunner(vi.fn()),
      logger: logger(),
      version: "0.10.0",
    });
    // Off is off even for a perfect credential: the switch is checked before
    // anything else so a disabled deployment never touches the store.
    await expect(
      off.ask(`Bearer ${token}`, QUESTION, new AbortController().signal),
    ).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("dies with the account it belongs to", async () => {
    const api = service({ accounts, runner: quietRunner(vi.fn()) });
    accounts.setUserDisabled("op@example.com", true);
    await expect(
      api.ask(`Bearer ${token}`, QUESTION, new AbortController().signal),
    ).rejects.toMatchObject({ reason: "unauthorized" });
  });
});

describe("integration service reading a conversation", () => {
  let accounts: QaAccounts;
  let token: string;
  let chatId: string;

  beforeEach(() => {
    accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    token = accounts.mintServiceToken(admin.token, {
      scopes: ["ask", "sessions:read"],
    }).token;
    chatId = "session-1";
    accounts.reserveSession(admin.token, chatId);
  });

  const headerOf = () => `Bearer ${token}`;
  const query = { chatId: "session-1", after: 0, limit: 50 };

  it("reads the account's own conversation through its own scope", async () => {
    const read = vi.fn(async () => ({
      chatId,
      messages: [{ seq: 2, role: "assistant" as const, text: "Ответ" }],
      lastSeq: 2,
      truncated: false,
    }));
    const api = service({ accounts, runner: quietRunner(vi.fn(), read) });
    await expect(api.session(headerOf(), query)).resolves.toMatchObject({
      chatId,
      lastSeq: 2,
    });
    expect(read).toHaveBeenCalledWith(query);
  });

  it("refuses a token that may ask but not read", async () => {
    const askOnly = accounts.mintServiceToken(
      accounts.login("op@example.com", "password-1").token,
      { scopes: ["ask"] },
    );
    const read = vi.fn();
    const api = service({ accounts, runner: quietRunner(vi.fn(), read) });
    await expect(
      api.session(`Bearer ${askOnly.token}`, query),
    ).rejects.toMatchObject({ reason: "forbidden", status: 403 });
    expect(read).not.toHaveBeenCalled();
  });

  it("answers an unknown chat and another account's chat the same way", async () => {
    const read = vi.fn();
    const api = service({ accounts, runner: quietRunner(vi.fn(), read) });
    await expect(
      api.session(headerOf(), { ...query, chatId: "session-unknown" }),
    ).rejects.toMatchObject({ reason: "not-found", status: 404 });

    // A second account's chat is not distinguishable from one that does not
    // exist: the id alone must not confirm that it is somebody's.
    const other = accounts.register("other@example.com", "password-2");
    const otherToken = accounts.mintServiceToken(other.token, {
      scopes: ["sessions:read"],
    }).token;
    await expect(
      api.session(`Bearer ${otherToken}`, query),
    ).rejects.toMatchObject({ reason: "not-found", status: 404 });
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a missing credential and a disabled deployment", async () => {
    const api = service({ accounts, runner: quietRunner(vi.fn()) });
    await expect(api.session(undefined, query)).rejects.toMatchObject({
      reason: "unauthorized",
      status: 401,
    });
    const off = new QaIntegrationService({
      getConfig: () =>
        resolveConfig({
          accounts: { enabled: true },
          integration: { enabled: false },
        }),
      accounts: () => accounts,
      runner: quietRunner(vi.fn()),
      logger: logger(),
      version: "0.10.0",
    });
    await expect(off.session(headerOf(), query)).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  it("reports a log the Host cannot read as a failed read, not an empty chat", async () => {
    const api = service({
      accounts,
      runner: quietRunner(vi.fn(), async () => {
        throw new Error("the session log is unavailable (unreadable)");
      }),
    });
    await expect(api.session(headerOf(), query)).rejects.toThrow(
      /session log is unavailable/u,
    );
  });
});

describe("integration service answering", () => {
  let accounts: QaAccounts;
  let token: string;

  beforeEach(() => {
    accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    token = accounts.mintServiceToken(admin.token, { scopes: ["ask"] }).token;
  });

  const headerOf = () => `Bearer ${token}`;
  const signal = () => new AbortController().signal;

  it("answers with the turn's text, citations and no escalation", async () => {
    const run = vi.fn(async () => turn());
    const api = service({ accounts, runner: quietRunner(run) });
    const answer = await api.ask(headerOf(), QUESTION, signal());
    expect(answer).toEqual({
      chatId: "session-1",
      answer: "**Ответ**\n\nТекст ответа.",
      sources: ["doc-1.pdf#стр.12"],
      confidence: "medium",
      escalate: false,
      reason: "",
    });
    // The question reaches the runner with its identity and ticket, and
    // nothing about the credential.
    const [input] = run.mock.calls[0] as unknown as [
      { userId: string; chatId: string | null; ticketKey: string | null },
    ];
    expect(input.userId).toBe(
      accounts.login("op@example.com", "password-1").user.id,
    );
    expect(input.chatId).toBeNull();
    expect(input.ticketKey).toBe("PROJ-123");
  });

  it("bounds and de-duplicates the citations", async () => {
    const many = [
      ...Array.from({ length: 8 }, (_, index) => source(index)),
      source(0),
    ];
    const api = service({
      accounts,
      runner: quietRunner(async () => turn({ sources: many })),
    });
    const answer = await api.ask(headerOf(), QUESTION, signal());
    expect(answer.sources).toHaveLength(5);
    expect(new Set(answer.sources).size).toBe(5);
  });

  it("cuts an over-long answer to the configured publication budget", async () => {
    const long = Array.from(
      { length: 200 },
      (_, index) => `Пункт ${String(index)}: подробное объяснение.`,
    ).join("\n\n");
    const api = service({
      accounts,
      integration: { maxAnswerCharacters: 512 },
      runner: quietRunner(async () => turn({ answer: long, sources: [] })),
    });
    const answered = await api.ask(headerOf(), QUESTION, signal());
    // A cut answer is still an answer: the ticket gets a readable head, not an
    // escalation, and the cut lands on a break between paragraphs.
    expect(answered.escalate).toBe(false);
    expect(answered.reason).toBe("");
    expect(answered.answer.endsWith("…")).toBe(true);
    expect(answered.answer.length).toBeLessThanOrEqual(512);
    expect(long.startsWith(answered.answer.slice(0, -1))).toBe(true);
    expect(answered.answer.slice(0, -1).endsWith("объяснение.")).toBe(true);
  });

  it("answers an unreadable attachment with the fallback the caller retries on", async () => {
    // A document the deployment's pipeline could not read refuses the whole
    // question: the caller repeats it without the attachment (415) rather than
    // receiving an answer to a question the model saw no material for.
    const api = service({
      accounts,
      runner: quietRunner(async () => {
        throw new QaIntegrationAttachmentError(
          "Договор.pdf",
          "unsupported",
          "the document pipeline could not read Договор.pdf",
        );
      }),
    });
    await expect(api.ask(headerOf(), QUESTION, signal())).rejects.toMatchObject(
      {
        reason: "unsupported-media",
        status: 415,
      },
    );
  });

  it("answers a Harness attachment refusal with the caller's own fallback", async () => {
    // The session controller refuses the prompt itself when it will not admit
    // an attachment — over its byte, pixel or dimension budget, bytes that are
    // not the type the caller declared, or a model that cannot see images at
    // all — as one Remote failure. Every one of those is caller-correctable, so
    // it is the 415 the bridge repeats without attachments, never a 5xx it
    // would retry forever.
    const api = service({
      accounts,
      runner: quietRunner(async () => {
        throw new RemoteError(
          "session/attachment-invalid",
          'Model "demo-model" does not support image input.',
          { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" },
        );
      }),
    });
    await expect(api.ask(headerOf(), QUESTION, signal())).rejects.toMatchObject(
      {
        reason: "unsupported-media",
        status: 415,
      },
    );
    // The Harness's own reason code reaches the caller's log through the body,
    // which is what tells an operator the model route has no vision.
    await expect(api.ask(headerOf(), QUESTION, signal())).rejects.toThrow(
      /MODEL_DOES_NOT_SUPPORT_IMAGES/u,
    );
  });

  it("keeps a failure that is not the caller's to fix retryable", async () => {
    const api = service({
      accounts,
      runner: quietRunner(async () => {
        throw new Error("the QA session has no live agent");
      }),
    });
    await expect(api.ask(headerOf(), QUESTION, signal())).rejects.toMatchObject(
      {
        reason: "unavailable",
        status: 503,
      },
    );
  });

  it("escalates instead of publishing an empty or interrupted turn", async () => {
    const empty = service({
      accounts,
      runner: quietRunner(async () => turn({ answer: "   ", sources: [] })),
    });
    expect(await empty.ask(headerOf(), QUESTION, signal())).toMatchObject({
      answer: "",
      escalate: true,
      confidence: "low",
      reason: "the assistant produced no answer",
    });

    const interrupted = service({
      accounts,
      runner: quietRunner(async () => turn({ interrupted: true })),
    });
    expect(await interrupted.ask(headerOf(), QUESTION, signal())).toMatchObject(
      {
        escalate: true,
        reason: "turn interrupted",
      },
    );
  });

  it("answers a timed-out question with an escalation that keeps the chat", async () => {
    vi.useFakeTimers();
    const api = service({
      accounts,
      integration: { requestTimeoutMs: 5000 },
      runner: quietRunner(
        (input) =>
          new Promise<QaIntegrationTurn>((_resolve, reject) => {
            input.onChat?.("session-9");
            input.signal.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          }),
      ),
    });
    const pending = api.ask(headerOf(), QUESTION, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5001);
    // The bridge gets a publishable answer inside its own budget and a chat it
    // can continue, instead of a 5xx retry that would orphan the running turn.
    await expect(pending).resolves.toEqual({
      chatId: "session-9",
      answer: "",
      sources: [],
      confidence: "low",
      escalate: true,
      reason: "the request timed out",
    });
    vi.useRealTimers();
  });

  it("turns a host failure into a retryable answer, not an escalation", async () => {
    const api = service({
      accounts,
      runner: quietRunner(async () => {
        throw new Error("the model provider is unreachable");
      }),
    });
    await expect(api.ask(headerOf(), QUESTION, signal())).rejects.toMatchObject(
      {
        reason: "unavailable",
        status: 503,
      },
    );
  });

  it("holds a token to its per-minute budget and the deployment to its concurrency", async () => {
    const budget = service({
      accounts,
      integration: { requestsPerMinute: 1 },
      runner: quietRunner(async () => turn()),
    });
    await expect(
      budget.ask(headerOf(), QUESTION, signal()),
    ).resolves.toBeDefined();
    await expect(
      budget.ask(headerOf(), QUESTION, signal()),
    ).rejects.toMatchObject({
      reason: "rate-limited",
      status: 429,
    });

    let release: (() => void) | undefined;
    const blocked = service({
      accounts,
      integration: { maxConcurrent: 1 },
      runner: quietRunner(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return turn();
      }),
    });
    const first = blocked.ask(headerOf(), QUESTION, signal());
    await vi.waitFor(() => expect(blocked.busy).toBe(1));
    await expect(
      blocked.ask(headerOf(), QUESTION, signal()),
    ).rejects.toMatchObject({
      reason: "busy",
      status: 429,
    });
    release?.();
    await expect(first).resolves.toBeDefined();
    expect(blocked.busy).toBe(0);
  });

  it("reports health with the deployment's routable models", async () => {
    let clock = Date.now();
    const api = service({
      accounts,
      runner: quietRunner(
        async () => turn(),
        undefined,
        async () => ["gpt-4o-mini", "local-llm-v3"],
      ),
      now: () => clock,
    });
    expect((await api.health(headerOf())).uptimeS).toBe(0);
    clock += 86_400_000;
    const health = await api.health(headerOf());
    expect(health.ok).toBe(true);
    expect(health.version).toBe("0.10.0");
    expect(health.models).toEqual(["gpt-4o-mini", "local-llm-v3"]);
    expect(health.uptimeS).toBe(86_400);
  });

  it("answers health even when no provider can be listed", async () => {
    const api = service({
      accounts,
      runner: quietRunner(
        async () => turn(),
        undefined,
        async () => {
          throw new Error("no provider is configured");
        },
      ),
    });
    await expect(api.health(headerOf())).resolves.toMatchObject({
      ok: true,
      models: [],
    });
  });

  it("keeps a dropped connection out of the answer path", async () => {
    const controller = new AbortController();
    const api = service({
      accounts,
      runner: quietRunner(
        (input) =>
          new Promise<QaIntegrationTurn>((_resolve, reject) => {
            input.signal.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          }),
      ),
    });
    const pending = api.ask(headerOf(), QUESTION, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(QaIntegrationError);
    expect(api.busy).toBe(0);
  });
});

describe("integration service refusal mapping", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives every reason the status the bridge branches on", () => {
    const cases: readonly [string, number][] = [
      ["unauthorized", 401],
      ["forbidden", 403],
      ["invalid-request", 400],
      ["unsupported-media", 415],
      ["payload-too-large", 413],
      ["rate-limited", 429],
      ["busy", 429],
      ["unavailable", 503],
      ["timeout", 504],
    ];
    for (const [reason, status] of cases) {
      const error = new QaIntegrationError(reason as never, "refused");
      expect(error.status).toBe(status);
    }
  });
});
