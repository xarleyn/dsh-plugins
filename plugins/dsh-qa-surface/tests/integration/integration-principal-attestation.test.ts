import { describe, expect, it } from "vitest";
import { QaAttestationError } from "../../src/attestation.js";
import { QaIntegrationPrincipalBindings } from "../../src/integration-principals.js";
import {
  QaPolicyAdmission,
  type QaAccountsGate,
} from "../../src/secure-session.js";
import { resolveConfig } from "../../src/resolve-config.js";

/**
 * The principal half of the integration path.
 *
 * `@yadsh/dsh-qa-integrations` resolves the identity a tool may spend from this
 * binding and refuses a chat without one (`Session is not bound to a QA user`),
 * so a chat the integration API opened had nothing to spend: its runner attested
 * the policy through `secureSessionForUser`, which checked the ownership record
 * and wrote no binding, while only the browser's own path filled one. Every
 * provider tool of every integration failed in those chats — a wrong refusal,
 * because the account behind the chat had been proven against the record a
 * moment earlier.
 */

const OWNER = "account-1";
const SESSION = "session-1";

interface HarnessOptions {
  /** Whom the ownership record names for the session. */
  readonly owner: string | undefined;
  /** The parent session, when the session is a delegated child. */
  readonly parent?: string;
  readonly bindings?: QaIntegrationPrincipalBindings;
  /** A deployment composed without accounts: admission gets no gate at all. */
  readonly noGate?: boolean;
}

/** One admission, its bindings, and a root agent the Host can resolve. */
function harness(options: HarnessOptions): {
  admission: QaPolicyAdmission;
  bindings: QaIntegrationPrincipalBindings;
} {
  const bindings = options.bindings ?? new QaIntegrationPrincipalBindings();
  const agent = {
    session: {
      id: SESSION,
      header: {
        id: SESSION,
        cwd: "D:/qa-workspace",
        createdAt: Date.now(),
        ...(options.parent === undefined
          ? {}
          : { parentSession: options.parent }),
      },
    },
  };
  const gate: QaAccountsGate = {
    enforceSessionAccess: () => ({ id: OWNER }),
    userWorkspace: () => "D:/qa-workspace",
    ownerIdOf: () => options.owner,
  };
  const admission = new QaPolicyAdmission(
    {
      on: () => () => undefined,
      agents: { get: () => agent },
      sessionController: {
        resolveAgent: async () => ({ error: new Error("no such session") }),
      },
      tools: { guard: () => () => undefined },
    } as never,
    () =>
      resolveConfig({
        accounts: { enabled: true },
        lockdown: { enabled: false },
      }),
    { debug() {}, info() {}, warn() {}, error() {}, close() {} } as never,
    options.noGate === true ? undefined : gate,
    undefined,
    undefined,
    undefined,
    bindings,
  );
  return { admission, bindings };
}

describe("integration principal attestation", () => {
  it("binds the owner the admission has just checked", async () => {
    const { admission, bindings } = harness({ owner: OWNER });
    await expect(
      admission.secureSessionForUser(OWNER, SESSION),
    ).resolves.toMatchObject({ sessionId: SESSION });
    expect(bindings.resolve(SESSION, OWNER)).toEqual({ userId: OWNER });
  });

  it("binds nothing for a chat the authenticated account does not own", async () => {
    const { admission, bindings } = harness({ owner: "account-2" });
    await expect(
      admission.secureSessionForUser(OWNER, SESSION),
    ).rejects.toBeInstanceOf(QaAttestationError);
    expect(bindings.resolve(SESSION, OWNER)).toBeUndefined();
    expect(bindings.resolve(SESSION, "account-2")).toBeUndefined();
  });

  it("clears the binding when a later attestation is refused", async () => {
    // The runner re-attests a continued chat before every question, so this is
    // the shape of an ownership record that moved between two questions.
    const bindings = new QaIntegrationPrincipalBindings();
    const first = harness({ owner: OWNER, bindings });
    await first.admission.secureSessionForUser(OWNER, SESSION);
    expect(bindings.resolve(SESSION, OWNER)).toEqual({ userId: OWNER });

    const moved = harness({ owner: "account-2", bindings });
    await expect(
      moved.admission.secureSessionForUser(OWNER, SESSION),
    ).rejects.toBeInstanceOf(QaAttestationError);
    expect(bindings.resolve(SESSION, OWNER)).toBeUndefined();
  });

  it("never binds a delegated child of an attested chat", async () => {
    const { admission, bindings } = harness({
      owner: OWNER,
      parent: "session-root",
    });
    await expect(
      admission.secureSessionForUser(OWNER, SESSION),
    ).rejects.toBeInstanceOf(QaAttestationError);
    expect(bindings.resolve(SESSION, OWNER)).toBeUndefined();
  });

  it("binds nothing on a deployment that runs no accounts gate", async () => {
    // With no record to compare against, the caller's account is an assertion,
    // not a proof — and the admission still attests the policy the way it did
    // before accounts existed.
    const bindings = new QaIntegrationPrincipalBindings();
    const { admission } = harness({ owner: OWNER, bindings, noGate: true });
    await expect(
      admission.secureSessionForUser(OWNER, SESSION),
    ).resolves.toMatchObject({ sessionId: SESSION });
    expect(bindings.resolve(SESSION, OWNER)).toBeUndefined();
  });
});
