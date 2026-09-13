import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QaAccounts } from "../src/accounts/store.js";
import { resolveConfig } from "../src/resolve-config.js";
import {
  QA_IDENTITY_INSTRUCTIONS_SECTION,
  QA_IDENTITY_SECTION,
  QaUserIdentity,
  renderUserIdentity,
} from "../src/user-identity.js";
import type {
  QaAccountIdentityField,
  ResolvedQaSurfaceConfig,
} from "../src/types.js";

const FIELDS: readonly QaAccountIdentityField[] = [
  { key: "jira", label: "Jira" },
  { key: "gitlab", label: "GitLab" },
];

function store(): QaAccounts {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-identity-"));
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

interface FakeSession {
  readonly id: string;
  readonly header: { readonly id: string; readonly parentSession?: string };
}

interface FakeAgent {
  readonly id: string;
  readonly session: FakeSession;
  readonly sections: Map<
    string,
    { readonly order: number; readonly text: string | ((c: unknown) => string) }
  >;
}

/**
 * A context just wide enough for the injector: the untagged `agent/created`
 * listener the plugin registers, the agent registry `ensure` reads, and the
 * live session registry the delegation chain walks.
 */
function harness(options: {
  readonly accounts?: QaAccounts | undefined;
  readonly config?: ResolvedQaSurfaceConfig;
}) {
  const listeners = new Set<(event: { agent: unknown }) => void>();
  const sessions = new Map<string, FakeSession>();
  const agents = new Map<string, FakeAgent>();
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
    on: (type: string, listener: (event: { agent: unknown }) => void) => {
      if (type !== "agent/created") return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    agents: { get: (id: string) => agents.get(id) },
    sessions: { get: (id: string) => sessions.get(id) },
  };
  const identity = new QaUserIdentity(ctx as never, {
    config: () => options.config ?? resolveConfig(),
    accounts: () => options.accounts,
    logger: silent as never,
  });
  /** Create one agent the way the harness would, publishing `agent/created`. */
  const createAgent = (id: string, parentSession?: string): FakeAgent => {
    const session: FakeSession = {
      id,
      header: parentSession === undefined ? { id } : { id, parentSession },
    };
    sessions.set(id, session);
    const sections: FakeAgent["sections"] = new Map();
    const agent = {
      id,
      session,
      sections,
      ctx: {
        systemPrompt: {
          section: (input: {
            name: string;
            order: number;
            text: string | ((c: unknown) => string);
          }) => {
            sections.set(input.name, input);
            return () => sections.delete(input.name);
          },
        },
      },
    };
    agents.set(id, agent);
    for (const listener of [...listeners]) listener({ agent });
    return agent;
  };
  /** Resolve one registered section's text the way assembly would. */
  const textOf = (agent: FakeAgent, name: string): string | undefined => {
    const section = agent.sections.get(name);
    if (section === undefined) return undefined;
    return typeof section.text === "function" ? section.text({}) : section.text;
  };
  return { identity, createAgent, textOf, listeners };
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

describe("user identity prompt text", () => {
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

describe("QaUserIdentity attachment", () => {
  it("installs nothing while the chat has no owner", () => {
    const { createAgent } = harness({ accounts: store() });
    const agent = createAgent("session-orphan");
    expect(agent.sections.size).toBe(0);
  });

  it("installs both sections on the owner's agent", () => {
    const { accounts, token } = owningStore();
    accounts.setProfile("i.ivanov@example.com", {
      fullName: "Иван Иванов",
      identities: { jira: "i.ivanov" },
      instructions: "Отвечай кратко.",
    });
    const { createAgent, textOf } = harness({ accounts, config: config() });
    const agent = createAgent("session-root");
    expect(textOf(agent, QA_IDENTITY_SECTION)).toContain("Иван Иванов");
    expect(textOf(agent, QA_IDENTITY_SECTION)).toContain("- Jira: i.ivanov");
    expect(textOf(agent, QA_IDENTITY_INSTRUCTIONS_SECTION)).toContain(
      "Отвечай кратко.",
    );
    expect(token).toBeTruthy();
  });

  it("carries the root chat's identity into a delegated child", () => {
    const { accounts } = owningStore();
    const { createAgent, textOf } = harness({ accounts, config: config() });
    createAgent("session-root");
    const child = createAgent("session-child", "session-root");
    expect(textOf(child, QA_IDENTITY_SECTION)).toContain(
      "i.ivanov@example.com",
    );
    expect(child.sections.has(QA_IDENTITY_INSTRUCTIONS_SECTION)).toBe(true);
  });

  it("resolves the profile at assembly time, so edits land at once", () => {
    const { accounts } = owningStore();
    const { createAgent, textOf } = harness({ accounts, config: config() });
    const agent = createAgent("session-root");
    expect(textOf(agent, QA_IDENTITY_SECTION)).toMatch(
      /instead of guessing a handle/u,
    );
    accounts.setProfile("i.ivanov@example.com", {
      fullName: "",
      identities: { gitlab: "@iivanov" },
      instructions: "",
    });
    expect(textOf(agent, QA_IDENTITY_SECTION)).toContain("- GitLab: @iivanov");
  });

  it("leaves the prompt when the account is disabled", () => {
    const { accounts } = owningStore();
    const { createAgent, textOf } = harness({ accounts, config: config() });
    const agent = createAgent("session-root");
    expect(textOf(agent, QA_IDENTITY_SECTION)).not.toBe("");
    accounts.setUserDisabled("i.ivanov@example.com", true);
    expect(textOf(agent, QA_IDENTITY_SECTION)).toBe("");
    expect(textOf(agent, QA_IDENTITY_INSTRUCTIONS_SECTION)).toBe("");
  });

  it("obeys the deployment's profile switches", () => {
    const { accounts } = owningStore();
    const off = harness({
      accounts,
      config: resolveConfig({
        accounts: { enabled: true, profile: { inject: false } },
      }),
    });
    const agent = off.createAgent("session-root");
    expect(off.textOf(agent, QA_IDENTITY_SECTION)).toBe("");
    expect(off.createAgent("session-child", "session-root").sections.size).toBe(
      2,
    );
  });

  it("catches up a session that was claimed after its agent existed", () => {
    const accounts = store();
    const { token } = accounts.register("i.ivanov@example.com", "password-1");
    const { createAgent, identity, textOf } = harness({
      accounts,
      config: config(),
    });
    const agent = createAgent("session-adopted");
    expect(agent.sections.size).toBe(0);
    accounts.claimSessions(token, ["session-adopted"]);
    identity.ensure("session-adopted");
    expect(textOf(agent, QA_IDENTITY_SECTION)).toContain(
      "i.ivanov@example.com",
    );
  });

  it("stops attaching once disposed, and registers no global side effect", () => {
    const { accounts } = owningStore();
    const { createAgent, identity, listeners } = harness({
      accounts,
      config: config(),
    });
    expect(listeners.size).toBe(1);
    identity.dispose();
    expect(listeners.size).toBe(0);
    expect(createAgent("session-root").sections.size).toBe(0);
  });
});
