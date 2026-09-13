import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QaAccounts } from "../src/accounts/store.js";
import { QA_REPORT_SOURCES_TOOL } from "../src/provenance/host-store.js";
import {
  QA_IDENTITY_NOTE,
  QA_NOTES_PLUGIN,
  QA_SOURCES_NOTE,
  QaPromptNotes,
  renderUserIdentity,
} from "../src/prompt-notes.js";
import { resolveConfig } from "../src/resolve-config.js";
import type {
  QaAccountIdentityField,
  ResolvedQaSurfaceConfig,
} from "../src/types.js";

const FIELDS: readonly QaAccountIdentityField[] = [
  { key: "jira", label: "Jira" },
  { key: "gitlab", label: "GitLab" },
];

function store(): QaAccounts {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-notes-"));
  return new QaAccounts(path.join(dir, "qa-accounts.json"), {
    sessionTtlDays: 30,
    allowRegistration: true,
    instructionsMaxLength: 2_000,
    identityFields: FIELDS,
  });
}

function config(
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
function harness(options: {
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
function noteText(message: FakeMessage | undefined): string {
  const content = message?.content as
    readonly { readonly type: string; readonly text?: string }[] | undefined;
  return (content ?? [])
    .flatMap((block) => (block.type === "text" ? [block.text ?? ""] : []))
    .join("\n");
}

/** The note names one injected message declares. */
function noteNames(message: FakeMessage | undefined): readonly string[] {
  const source = message?.source as
    { readonly sections?: readonly { readonly name: string }[] } | undefined;
  return (source?.sections ?? []).map((section) => section.name);
}

function owningStore(options: { readonly sessionId?: string } = {}): {
  readonly accounts: QaAccounts;
  readonly token: string;
} {
  const accounts = store();
  const session = accounts.register("i.ivanov@example.com", "password-1");
  accounts.reserveSession(session.token, options.sessionId ?? "session-root");
  return { accounts, token: session.token };
}

describe("user identity text", () => {
  it("says nothing without an account address", () => {
    expect(
      renderUserIdentity({
        email: "  ",
        profile: {
          fullName: "Иван",
          identities: { jira: "i.ivanov" },
          instructions: "Кратко",
          updatedAt: null,
        },
        identities: FIELDS,
      }),
    ).toEqual({ identity: "", instructions: "" });
  });

  it("renders the name, handles and the self-declared caveat", () => {
    const rendered = renderUserIdentity({
      email: "i.ivanov@example.com",
      profile: {
        fullName: "Иван Иванов",
        identities: { jira: "i.ivanov", gitlab: "@iivanov" },
        instructions: "",
        updatedAt: null,
      },
      identities: FIELDS,
    });
    expect(rendered.identity).toContain(
      "Current QA user: Иван Иванов <i.ivanov@example.com>",
    );
    expect(rendered.identity).toContain("- Jira: i.ivanov");
    expect(rendered.identity).toContain("- GitLab: @iivanov");
    expect(rendered.identity).toMatch(/self-declared/u);
    expect(rendered.identity).toMatch(/name the identifier you used/u);
    expect(rendered.instructions).toBe("");
  });

  it("asks for the missing handle rather than guessing one", () => {
    const rendered = renderUserIdentity({
      email: "i.ivanov@example.com",
      profile: {
        fullName: "",
        identities: {},
        instructions: "",
        updatedAt: null,
      },
      identities: FIELDS,
    });
    expect(rendered.identity).toContain(
      "Current QA user: i.ivanov@example.com",
    );
    expect(rendered.identity).toMatch(/instead of guessing a handle/u);
  });

  it("frames the user's own instructions as preferences, not policy", () => {
    const rendered = renderUserIdentity({
      email: "i.ivanov@example.com",
      profile: {
        fullName: "",
        identities: { jira: "i.ivanov" },
        instructions: "Отвечай кратко.",
        updatedAt: null,
      },
      identities: FIELDS,
    });
    expect(rendered.instructions).toContain("not deployment policy");
    expect(rendered.instructions).toContain("Отвечай кратко.");
    expect(rendered.instructions).toContain('"""');
  });
});

describe("identity note", () => {
  it("stays silent while the chat has no owner", async () => {
    const { createSession, step } = harness({ accounts: store() });
    expect(await step(createSession("session-orphan"))).toEqual([]);
  });

  it("adds one note carrying the name, handles and instructions", async () => {
    const { accounts } = owningStore();
    accounts.setProfile("i.ivanov@example.com", {
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov" },
      instructions: "Отвечай кратко.",
    });
    const { createSession, step } = harness({ accounts, config: config() });
    const session = createSession("session-root");
    const appended = await step(session);
    expect(appended.length).toBe(1);
    const text = noteText(appended[0]);
    expect(text).toContain("Иван Иванов <i.ivanov@example.com>");
    expect(text).toContain("- Jira: i.ivanov");
    expect(text).toContain("Отвечай кратко.");
    expect(noteNames(appended[0])).toEqual([QA_IDENTITY_NOTE]);
    const source = appended[0]?.source as {
      readonly kind: string;
      readonly plugin: string;
      readonly form: string;
    };
    expect(source).toMatchObject({
      kind: "plugin",
      plugin: QA_NOTES_PLUGIN,
      form: "snapshot",
    });
    // The note is written once: the next step finds it in the conversation.
    expect(await step(session)).toEqual([]);
  });

  it("gives a delegated child its own copy", async () => {
    const { accounts } = owningStore();
    const { createSession, step } = harness({ accounts, config: config() });
    createSession("session-root");
    const child = createSession("session-child", "session-root");
    expect(noteText((await step(child))[0])).toContain("i.ivanov@example.com");
  });

  it("writes again only after the profile changed", async () => {
    const { accounts } = owningStore();
    const { createSession, step } = harness({ accounts, config: config() });
    const session = createSession("session-root");
    expect((await step(session)).length).toBe(1);
    accounts.setProfile("i.ivanov@example.com", {
      fullName: "",
      identities: { gitlab: "@iivanov" },
      instructions: "",
    });
    const afterEdit = await step(session);
    expect(afterEdit.length).toBe(1);
    expect(noteText(afterEdit[0])).toContain("- GitLab: @iivanov");
    expect(await step(session)).toEqual([]);
  });

  it("never repeats a note after a cold start", async () => {
    const { accounts } = owningStore();
    const first = harness({ accounts, config: config() });
    const session = first.createSession("session-root");
    expect((await first.step(session)).length).toBe(1);
    // A reloaded plugin holds no memory of the note; the conversation does.
    first.notes.dispose();
    const second = first.newNotes();
    expect(await first.step(session)).toEqual([]);
    second.dispose();
  });

  it("stays silent when the account is disabled or the feature is off", async () => {
    const { accounts } = owningStore();
    accounts.setUserDisabled("i.ivanov@example.com", true);
    const disabled = harness({ accounts, config: config() });
    expect(await disabled.step(disabled.createSession("session-a"))).toEqual(
      [],
    );

    const live = owningStore();
    const off = harness({
      accounts: live.accounts,
      config: resolveConfig({
        accounts: { enabled: true, profile: { inject: false } },
      }),
    });
    expect(await off.step(off.createSession("session-b"))).toEqual([]);
  });

  it("stops injecting once disposed", async () => {
    const { accounts } = owningStore();
    const { notes, createSession, step } = harness({
      accounts,
      config: config(),
    });
    notes.dispose();
    expect(await step(createSession("session-root"))).toEqual([]);
  });
});

describe("source provenance note", () => {
  it("reaches an attested session and names the fallback tool", async () => {
    const { createSession, step } = harness({
      config: config(),
      qaSessions: ["session-root"],
    });
    const session = createSession("session-root");
    const appended = await step(session);
    expect(appended.length).toBe(1);
    expect(noteNames(appended[0])).toEqual([QA_SOURCES_NOTE]);
    expect(noteText(appended[0])).toMatch(/manual Sources\/Источники/u);
    expect(noteText(appended[0])).toContain(QA_REPORT_SOURCES_TOOL);
    expect(await step(session)).toEqual([]);
  });

  it("stays out of chats the QA surface never attested", async () => {
    const { createSession, step } = harness({ config: config() });
    expect(await step(createSession("session-operator"))).toEqual([]);
  });

  it("follows the sources switches", async () => {
    const noSources = harness({
      config: resolveConfig({ sources: { enabled: false } }),
      qaSessions: ["session-root"],
    });
    expect(
      await noSources.step(noSources.createSession("session-root")),
    ).toEqual([]);

    const noFallback = harness({
      config: resolveConfig({
        sources: { subagents: { enableReportToolFallback: false } },
      }),
      qaSessions: ["session-root"],
    });
    const appended = await noFallback.step(
      noFallback.createSession("session-root"),
    );
    expect(noteText(appended[0])).toMatch(/manual Sources\/Источники/u);
    expect(noteText(appended[0])).not.toContain(QA_REPORT_SOURCES_TOOL);
  });

  it("reaches a delegated child through its root session", async () => {
    const { createSession, step } = harness({
      config: config(),
      qaSessions: ["session-root"],
    });
    createSession("session-root");
    const child = createSession("session-child", "session-root");
    expect(noteNames((await step(child))[0])).toEqual([QA_SOURCES_NOTE]);
  });

  it("carries both notes in one step for an owned QA chat", async () => {
    const { accounts } = owningStore();
    const { createSession, step } = harness({
      accounts,
      config: config(),
      qaSessions: ["session-root"],
    });
    const session = createSession("session-root");
    const appended = await step(session);
    expect([...appended.flatMap(noteNames)].sort()).toEqual(
      [QA_SOURCES_NOTE, QA_IDENTITY_NOTE].sort(),
    );
    expect(await step(session)).toEqual([]);
  });
});
