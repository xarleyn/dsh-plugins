import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { QaAccounts } from "../../src/accounts/store.js";
import { QaPromptNotes } from "../../src/prompt-notes.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type {
  QaAccountIdentityField,
  ResolvedQaSurfaceConfig,
} from "../../src/types.js";

export const FIELDS: readonly QaAccountIdentityField[] = [
  { key: "jira", label: "Jira" },
  { key: "gitlab", label: "GitLab" },
];

export function store(): QaAccounts {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-notes-"));
  return new QaAccounts(path.join(dir, "qa-accounts.db"), {
    sessionTtlDays: 30,
    allowRegistration: true,
    instructionsMaxLength: 2_000,
    identityFields: FIELDS,
  });
}

export function config(
  overrides: Record<string, unknown> = {},
): ResolvedQaSurfaceConfig {
  return resolveConfig({
    accounts: {
      enabled: true,
      profile: { identities: FIELDS.map((field) => ({ ...field })) },
    },
    ...overrides,
  });
}

/** One model-facing message as the loop hands it to a step. */
interface FakeMessage {
  readonly content?: unknown;
  readonly source?: unknown;
}

/** One durable session event, in the shape `eventAt` returns. */
interface FakeEvent {
  readonly type: string;
  readonly data: FakeMessage;
}

interface FakeSession {
  readonly id: string;
  readonly header: { readonly id: string; readonly parentSession?: string };
  readonly surface: { readonly nodes: number[] };
  readonly events: FakeEvent[];
  eventAt(seq: number): FakeEvent | undefined;
}

type PreStepListener = (
  payload: unknown,
  next: () => Promise<unknown>,
) => Promise<unknown>;

/**
 * A context just wide enough for the injector: the `agent/pre-step` waterfall
 * the plugin joins, the live session registry the delegation chain walks, and
 * a session whose surface records what each step appended — the same state the
 * injector reads back to avoid writing a note twice.
 */
export function harness(options: {
  readonly accounts?: QaAccounts | undefined;
  readonly config?: ResolvedQaSurfaceConfig;
  /** Sessions the admission attested; the provenance note's gate. */
  readonly qaSessions?: readonly string[];
}) {
  const listeners = new Set<PreStepListener>();
  const sessions = new Map<string, FakeSession>();
  const silent = {
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    close() {},
  };
  const ctx = {
    on: (type: string, listener: PreStepListener) => {
      if (type !== "agent/pre-step") return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sessions: { get: (id: string) => sessions.get(id) },
  };
  const newNotes = (): QaPromptNotes =>
    new QaPromptNotes(ctx as never, {
      config: () => options.config ?? resolveConfig(),
      accounts: () => options.accounts,
      isQaSession: (sessionId) =>
        (options.qaSessions ?? []).includes(sessionId),
      logger: silent as never,
    });
  const notes = newNotes();
  const createSession = (id: string, parentSession?: string): FakeSession => {
    const events: FakeEvent[] = [];
    const session: FakeSession = {
      id,
      header: parentSession === undefined ? { id } : { id, parentSession },
      surface: { nodes: [] },
      events,
      eventAt: (index: number) => events[index],
    };
    sessions.set(id, session);
    return session;
  };
  /** Run one pre-step the way the loop does, recording what it appended. */
  const step = async (
    session: FakeSession,
  ): Promise<readonly FakeMessage[]> => {
    const agent = { id: session.id, session };
    const question: FakeMessage = {
      content: [{ type: "text", text: "?" }],
      source: { kind: "user" },
    };
    const claimed: readonly FakeMessage[] = [question];
    let decision: { kind: string; messages: readonly FakeMessage[] } = {
      kind: "enter",
      messages: claimed,
    };
    for (const listener of listeners) {
      decision = (await listener(
        { agent, turn: 1, step: 1, signal: { aborted: false } },
        async () => decision,
      )) as typeof decision;
    }
    const appended = decision.messages.filter(
      (message) => !claimed.includes(message),
    );
    // The loop appends what the step returned; the injector reads it back
    // through the session surface on the next step.
    for (const message of appended) {
      session.events.push({ type: "user/message", data: message });
      session.surface.nodes.push(session.events.length - 1);
    }
    return appended;
  };
  return { notes, newNotes, createSession, step };
}

/** The text one injected message carries. */
export function noteText(message: FakeMessage | undefined): string {
  const content = message?.content as
    readonly { readonly type: string; readonly text?: string }[] | undefined;
  return (content ?? [])
    .flatMap((block) => (block.type === "text" ? [block.text ?? ""] : []))
    .join("\n");
}

/** The note names one injected message declares. */
export function noteNames(message: FakeMessage | undefined): readonly string[] {
  const source = message?.source as
    { readonly sections?: readonly { readonly name: string }[] } | undefined;
  return (source?.sections ?? []).map((section) => section.name);
}

export function owningStore(options: { readonly sessionId?: string } = {}): {
  readonly accounts: QaAccounts;
  readonly token: string;
} {
  const accounts = store();
  const session = accounts.register("i.ivanov@example.com", "password-1");
  accounts.reserveSession(session.token, options.sessionId ?? "session-root");
  return { accounts, token: session.token };
}
