import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredSessionEvent } from "../../src/admin/conversation-log.js";
import type { QaSessionLogReader } from "../../src/admin/session-log.js";
import type { QaAccounts } from "../../src/accounts/store.js";
import type { QaAskRequest } from "../../src/integration/contract.js";
import { createQaIntegrationRunner } from "../../src/integration/host-runner.js";
import { QaIntegrationService } from "../../src/integration/service.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { store } from "../accounts/accounts.helpers.js";

/**
 * What happens to a turn nobody is waiting for any more.
 *
 * `POST /ask` answers a question whose turn outlived the caller — a dropped
 * connection, or the budget the deployment configured — and both answers
 * release the service's own concurrency slot. What the endpoint cannot see is
 * the harness: the abandoned turn keeps running, keeps spending the model, and
 * keeps its chat's agent busy, so the next question continued into that chat
 * queues behind it and burns its own full budget on the wait. These tests pin
 * the two halves separately: the slot always comes back, and a turn is stopped
 * only when the *caller* gave up and the running turn is the one this request
 * opened.
 *
 * The budget is deliberately on the other side of that line. The published
 * contract is that a timed-out question keeps its turn running so a bridge can
 * pick the answer up from `GET {base}/session` with the `chat_id` the escalation
 * hands back (docs/INTEGRATION-API.md §2.5); stopping it would orphan the very
 * answer that path polls for.
 */

const QUESTION: QaAskRequest = Object.freeze({
  message: "Что нового в версии 3.8?",
  version: "3.8",
  sessionId: "chat-1",
  context: Object.freeze({
    ticketKey: "PROJ-123",
    reporter: "user@example.corp",
    reporterName: null,
  }),
  attachments: Object.freeze([]),
});

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
} as never;

/**
 * A chat whose agent admits a question and then never goes idle — the turn
 * running past every budget the caller and the deployment set.
 *
 * @param input.claim - whether the harness writes this request's prompt row,
 * i.e. whether the running turn belongs to it. With `false` the log holds only
 * another question's turn, which is what a queued prompt looks like.
 * @param input.closeOwnTurn - write the closer of the claimed turn, so the
 * agent is busy with *later* work while this request is still waiting.
 */
function stuckChat(input: {
  readonly claim: boolean;
  readonly closeOwnTurn?: boolean;
}) {
  const events: StoredSessionEvent[] = [];
  let seq = 0;
  const push = (type: string, data: unknown): void => {
    seq += 1;
    events.push({ seq, time: 1_700_000_000_000 + seq, type, data });
  };
  const prompt = vi.fn(
    async (request: { readonly requestId: string }): Promise<void> => {
      if (input.claim) {
        push("turn/start", { turn: 1 });
        push("user/message", {
          role: "user",
          source: { kind: "user", rpcId: request.requestId },
          content: [{ type: "text", text: "вопрос" }],
        });
        if (input.closeOwnTurn === true) {
          push("turn/end", { turn: 1, reason: { kind: "done" } });
          // The agent has moved on to somebody else's question.
          push("turn/start", { turn: 2 });
        }
        return;
      }
      push("turn/start", { turn: 1 });
      push("user/message", {
        role: "user",
        source: { kind: "user", rpcId: "another-request-id" },
        content: [{ type: "text", text: "чужой вопрос" }],
      });
    },
  );
  const cancel = vi.fn();
  const read = vi.fn(async () => ({ ok: true as const, events: [...events] }));
  const rpcIdOf = (): string => {
    const request = prompt.mock.calls.at(-1)?.[0] as
      { readonly requestId: string } | undefined;
    return request?.requestId ?? "";
  };
  return {
    prompt,
    cancel,
    read,
    rpcIdOf,
    agent: { whenIdle: () => new Promise<void>(() => {}) },
    ctx: {
      sessionController: {
        prompt,
        cancel,
        modelCatalog: async () => ({ groups: [] }),
      },
      agents: { get: () => ({ whenIdle: () => new Promise<void>(() => {}) }) },
    } as never,
    sessionLog: {
      list: vi.fn(),
      live: () => true,
      snapshot: () => undefined,
      read: read as QaSessionLogReader["read"],
    } as never,
  };
}

function chatRunner(chat: ReturnType<typeof stuckChat>) {
  return createQaIntegrationRunner({
    ctx: chat.ctx,
    getConfig: () =>
      resolveConfig({
        accounts: { enabled: true },
        integration: { enabled: true },
      }),
    accounts: () => undefined,
    admission: { secureSessionForUser: async () => {} } as never,
    access: {} as never,
    sessionLog: chat.sessionLog,
    provenance: { bundles: () => [] } as never,
    documents: () => undefined,
    logger,
  });
}

describe("integration turn cancellation", () => {
  let accounts: QaAccounts;
  let token: string;

  beforeEach(() => {
    accounts = store();
    const admin = accounts.register("op@example.com", "password-1");
    token = accounts.mintServiceToken(admin.token, { scopes: ["ask"] }).token;
  });

  const headerOf = () => `Bearer ${token}`;
  const signal = () => new AbortController().signal;

  function serviceOf(
    runner: ReturnType<typeof chatRunner>,
    integration: Record<string, unknown> = {},
    events?: string[],
  ) {
    const config = resolveConfig({
      accounts: { enabled: true },
      integration: { enabled: true, ...integration },
    });
    return new QaIntegrationService({
      getConfig: () => config,
      accounts: () => accounts,
      runner,
      logger: {
        debug() {},
        info() {},
        warn: (event: string) => events?.push(event),
        error() {},
        close() {},
      } as never,
      version: "0.0.0",
    });
  }

  it("stops the turn of a question whose caller disconnected", async () => {
    const chat = stuckChat({ claim: true });
    const dropped: string[] = [];
    const api = serviceOf(chatRunner(chat), {}, dropped);
    const controller = new AbortController();
    const pending = api.ask(headerOf(), QUESTION, controller.signal);
    await vi.waitFor(() => expect(chat.prompt).toHaveBeenCalled());

    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: "unavailable" });

    // The slot is back the moment the answer path ends — the stop is fired and
    // not awaited — and the turn is over: the chat's agent no longer holds work
    // nobody asked for, so the next question continued into this chat is not
    // queued behind it.
    expect(api.busy).toBe(0);
    await vi.waitFor(() => expect(chat.cancel).toHaveBeenCalled());
    expect(String(chat.cancel.mock.calls[0]?.[0]?.sessionId)).toBe("chat-1");
    // A caller that gave up is invisible on the answer path; the log is the only
    // place the stand learns that a turn was abandoned at all.
    expect(dropped).toContain("integration.dropped");
  });

  it("keeps the turn of a question that only ran out of budget", async () => {
    vi.useFakeTimers();
    const chat = stuckChat({ claim: true });
    const api = serviceOf(chatRunner(chat), { requestTimeoutMs: 5_000 });
    const pending = api.ask(headerOf(), QUESTION, signal());
    await vi.waitFor(() => expect(chat.prompt).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(5_001);

    // The escalation is the bridge's polling handle: the chat id it reads the
    // late answer from, so the budget alone must not stop the turn.
    await expect(pending).resolves.toMatchObject({
      chatId: "chat-1",
      escalate: true,
      reason: "the request timed out",
    });
    expect(api.busy).toBe(0);
    expect(chat.cancel).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not stop a turn that belongs to another question", async () => {
    // Our prompt is admitted but not claimed: the agent is running the other
    // caller's turn, and giving up must not spend it.
    const chat = stuckChat({ claim: false });
    const api = serviceOf(chatRunner(chat));
    const controller = new AbortController();
    const pending = api.ask(headerOf(), QUESTION, controller.signal);
    await vi.waitFor(() => expect(chat.prompt).toHaveBeenCalled());

    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: "unavailable" });
    expect(api.busy).toBe(0);
    await decisionMade(chat);
    expect(chat.cancel).not.toHaveBeenCalled();
  });

  it("does not stop a turn that has already committed its closer", async () => {
    // This request's row is claimed and its turn ended, but the agent went on
    // to a newer turn while the caller still held its connection open.
    const chat = stuckChat({ claim: true, closeOwnTurn: true });
    const api = serviceOf(chatRunner(chat));
    const controller = new AbortController();
    const pending = api.ask(headerOf(), QUESTION, controller.signal);
    await vi.waitFor(() => expect(chat.prompt).toHaveBeenCalled());

    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: "unavailable" });
    expect(api.busy).toBe(0);
    await decisionMade(chat);
    expect(chat.cancel).not.toHaveBeenCalled();
  });
});

/**
 * Until the abandonment has been decided rather than merely started: the stop
 * is fired without being awaited, so a "not cancelled" assertion right after the
 * rejection would pass even if the decision had never run. The decision is the
 * second read of the chat — the first is the cursor taken before the question.
 */
async function decisionMade(chat: {
  readonly read: ReturnType<typeof vi.fn>;
}): Promise<void> {
  await vi.waitFor(() => expect(chat.read).toHaveBeenCalledTimes(2));
}
