import { IntegrationError } from "../src/errors.js";
import { JIRA_OPERATIONS } from "../src/providers/jira/catalog.js";
import { JiraProvider } from "../src/providers/jira/index.js";
import { evaluateServiceOperation } from "../src/service-credentials/policy.js";
import { UNCLASSIFIED_OPERATION } from "../src/service-credentials/types.js";
import type { ServiceCredentialHealth } from "../src/service-credentials/types.js";
import {
  COMPANY,
  EMAIL,
  TOKEN,
  config,
  credential,
  profile,
  serviceContext,
  stub,
} from "./jira-service.helpers.js";

/** An issue the stubbed site answers, inside the boundary. */
const ISSUE = {
  id: "1",
  key: "PROJ-1",
  fields: {
    summary: "Payment timeout",
    project: { key: "PROJ", id: "10000" },
  },
};

/** The security probe every service-mode issue read makes before the read. */
function unrestricted() {
  return { json: { fields: { security: null } } };
}

describe("Jira managed service credentials", () => {
  it("classifies every catalog operation, leaving none unclassified", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new JiraProvider(config(), fetcher);
    for (const [operation, definition] of Object.entries(JIRA_OPERATIONS)) {
      const metadata = provider.operationMetadata?.(operation);
      expect(metadata, operation).toEqual(definition.security);
      expect(metadata?.effect, operation).toBe("read");
      expect(metadata?.serviceCredential, operation).toBeDefined();
    }
    // The catalog is all reads, so the whole surface is either service-safe
    // project reading or the one sensitive listing; nothing write-shaped
    // sneaks through as a read.
    expect(provider.operationMetadata?.("issues.attachments")).toMatchObject({
      sensitivity: "sensitive",
      serviceCredential: "deny",
    });
    expect(provider.operationMetadata?.("issues.get")).toMatchObject({
      sensitivity: "normal",
      serviceCredential: "allow",
      requiresResourceBoundary: true,
    });
    expect(provider.operationMetadata?.("connection.get")).toMatchObject({
      requiresResourceBoundary: false,
    });
    expect(provider.operationMetadata?.("fields.list")).toMatchObject({
      sensitivity: "normal",
      serviceCredential: "allow",
      requiresResourceBoundary: false,
    });
  });

  it("derives the capability states from the classifications", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new JiraProvider(config(), fetcher);
    expect(provider.capabilityServiceState?.("identity.read")).toBe(
      "available",
    );
    expect(provider.capabilityServiceState?.("issues.read")).toBe("available");
    expect(provider.capabilityServiceState?.("comments.read")).toBe(
      "available",
    );
    expect(provider.capabilityServiceState?.("attachments.read")).toBe(
      "sensitive",
    );
    expect(provider.capabilityServiceState?.("transitions.read")).toBe(
      "available",
    );
    expect(provider.capabilityServiceState?.("projects.read")).toBe(
      "available",
    );
    expect(provider.capabilityServiceState?.("fields.read")).toBe("available");
  });

  it("classifies attachment metadata out of the service credential", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    const metadata = provider.operationMetadata?.("issues.attachments");
    expect(metadata).toMatchObject({
      effect: "read",
      sensitivity: "sensitive",
      serviceCredential: "deny",
    });
    const decision = evaluateServiceOperation({
      metadata: metadata ?? UNCLASSIFIED_OPERATION,
      capability: "attachments.read",
      profile: profile(),
      boundaryKind: provider.resourceBoundaryKind?.("issues.attachments"),
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "SensitiveReadRequiresPersonalCredential",
    });

    // Defence in depth: the provider refuses on its own classification, so a
    // caller that reached it without the broker's decision — or a future broker
    // bug — still does not hand around what other users uploaded.
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "issues.attachments",
        { issueKey: "PROJ-1" },
      ),
    ).rejects.toMatchObject({
      code: "SensitiveReadRequiresPersonalCredential",
    });
    expect(calls).toEqual([]);
  });

  it("keeps issue and project reads service-safe inside the boundary", async () => {
    const { fetcher } = stub((url) =>
      url.searchParams.get("fields") === "security"
        ? unrestricted()
        : url.pathname.startsWith("/rest/api/3/project/")
          ? { json: { id: "10000", key: "PROJ", name: "PROJ" } }
          : { json: ISSUE },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "issues.get",
        { issueKey: "PROJ-1" },
      ),
    ).resolves.toMatchObject({ key: "PROJ-1" });
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "projects.get",
        { projectKey: "PROJ" },
      ),
    ).resolves.toMatchObject({ key: "PROJ" });
  });

  it("refuses a resource outside the boundary before anything is sent", async () => {
    const { fetcher, calls } = stub(() => ({ json: ISSUE }));
    const { provider, plaintext } = credential(fetcher);
    for (const [operation, input] of [
      ["issues.get", { issueKey: "TASK-9" }],
      ["issues.comments", { issueKey: "TASK-2" }],
      ["issues.transitions", { issueKey: "TASK-3" }],
      ["projects.get", { projectKey: "TASK" }],
    ] as const) {
      await expect(
        provider.execute(
          { credential: plaintext, ...serviceContext() },
          operation,
          input,
        ),
      ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    }
    expect(calls).toEqual([]);
  });

  it("filters a search to the boundary and drops restricted issues", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        issues: [
          {
            key: "PROJ-1",
            fields: { project: { key: "PROJ", id: "10000" }, security: null },
          },
          // Matched by the listed numeric id: Jira reports the project on the
          // hit either way.
          { key: "PROJ-2", fields: { project: { id: "10001" } } },
          { key: "TASK-5", fields: { project: { key: "TASK" } } },
          {
            key: "PROJ-4",
            fields: {
              project: { key: "PROJ" },
              security: { id: "10003", name: "Admins only" },
            },
          },
        ],
        isLast: true,
      },
    }));
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "issues.search",
      { query: "payment" },
    )) as { items: readonly { key: string }[] };
    expect(answer.items.map((item) => item.key)).toEqual(["PROJ-1", "PROJ-2"]);
    // The service page asks for the security level, because the filter needs it.
    expect(calls[0]?.url.searchParams.get("fields")).toContain("security");

    // The same question on a personal credential reads the page as it is.
    const personal = (await provider.execute(
      { credential: plaintext },
      "issues.search",
      { query: "payment" },
    )) as { items: readonly { key: string }[] };
    expect(personal.items).toHaveLength(4);
    expect(calls[1]?.url.searchParams.get("fields")).not.toContain("security");
  });

  it("refuses a person filter that would read the site directory", async () => {
    const { fetcher, calls } = stub(() => ({ json: { issues: [] } }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "issues.search",
        { query: "payment", assignee: "Иван Иванов" },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toEqual([]);
    // An account id is already what Jira filters on and costs no directory.
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "issues.search",
        { query: "payment", assignee: "5b10ac8d82e05b22cc7d4ef5" },
      ),
    ).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it("fails closed on an issue an issue-security level closes off", async () => {
    const { fetcher, calls } = stub((url) =>
      url.searchParams.get("fields") === "security"
        ? { json: { fields: { security: { id: "10003" } } } }
        : { json: ISSUE },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "issues.get",
        { issueKey: "PROJ-7" },
      ),
    ).rejects.toMatchObject({ code: "ResourceNotFound" });
    // The refusal is the answer of the security probe alone: the read itself
    // never happens.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe("/rest/api/3/issue/PROJ-7");
    expect(calls[0]?.url.searchParams.get("fields")).toBe("security");
  });

  it("serves an issue Jira leaves unrestricted, probing the level first", async () => {
    const { fetcher, calls } = stub((url) =>
      url.searchParams.get("fields") === "security"
        ? unrestricted()
        : { json: ISSUE },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "issues.comments",
        { issueKey: "PROJ-1" },
      ),
    ).resolves.toBeDefined();
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/rest/api/3/issue/PROJ-1",
      "/rest/api/3/issue/PROJ-1/comment",
    ]);
    expect(calls[0]?.url.searchParams.get("fields")).toBe("security");
  });

  it("fails closed when service mode arrives without a boundary", async () => {
    const { fetcher, calls } = stub(() => ({ json: ISSUE }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, credentialSource: "service" },
        "issues.get",
        { issueKey: "PROJ-1" },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toEqual([]);
  });

  it("leaves the personal mode untouched", async () => {
    const { fetcher, calls } = stub(() => ({ json: ISSUE }));
    const { provider, plaintext } = credential(fetcher);
    // No boundary, no service mode: a call is the plain read it always was,
    // with no security probe and no project restriction.
    await expect(
      provider.execute({ credential: plaintext }, "issues.get", {
        issueKey: "TASK-9",
      }),
    ).resolves.toBeDefined();
    await expect(
      provider.execute({ credential: plaintext }, "issues.attachments", {
        issueKey: "PROJ-1",
      }),
    ).resolves.toBeDefined();
    await expect(
      provider.execute({ credential: plaintext }, "projects.get", {
        projectKey: "TASK",
      }),
    ).resolves.toBeDefined();
    expect(
      calls.every((call) => call.url.searchParams.get("fields") !== "security"),
    ).toBe(true);
  });

  it("reports a service token healthy after the identity probe alone", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        accountId: "5b10ac8d82e05b22cc7d4ef5",
        displayName: "Alice Example",
        emailAddress: EMAIL,
      },
    }));
    const { provider, plaintext } = credential(fetcher);
    const health: ServiceCredentialHealth =
      (await provider.validateServiceCredential?.({
        credential: plaintext,
      })) as ServiceCredentialHealth;
    expect(health.status).toBe("healthy");
    expect(health.upstreamIdentity).toEqual({
      id: "5b10ac8d82e05b22cc7d4ef5",
      label: "Alice Example (alice@example.com)",
    });
    expect(health.grantedScopes).toBeUndefined();
    expect(health.warnings).toEqual([
      "Jira did not report the token scopes; the local service ceiling still applies",
    ]);
    // The probe is the one self-inspection read; a probe that changed upstream
    // state would be a write performed by a read-only credential.
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/rest/api/3/myself",
    ]);
  });

  it("maps a rejected service token onto its health status", async () => {
    const { fetcher } = stub(() => ({
      status: 401,
      json: { message: "401 Unauthorized" },
    }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.validateServiceCredential?.({ credential: plaintext }),
    ).resolves.toMatchObject({ status: "revoked" });
  });

  it("spends the deployment secret as the Basic pair the site names", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new JiraProvider(config(), fetcher);
    const parsed = provider.parseCredential(`${EMAIL}:${TOKEN}`, {
      instanceId: COMPANY.id,
    });
    expect(parsed.portal).toBe(COMPANY.baseUrl);
    expect(JSON.parse(parsed.credential)).toEqual({
      siteId: COMPANY.id,
      email: EMAIL,
      token: TOKEN,
    });
    // A secret without the account half cannot become a credential.
    expect(() =>
      provider.parseCredential(TOKEN, { instanceId: COMPANY.id }),
    ).toThrow(/e-mail of the Atlassian account/u);
    // The connect form still refuses a pasted pair: it collects the e-mail
    // next to the token, and the two must not be confused.
    expect(() =>
      provider.parseCredential(`${EMAIL}:${TOKEN}`, {
        siteId: COMPANY.id,
        email: EMAIL,
      }),
    ).toThrow(/Atlassian API token/u);
  });

  it("refuses an unknown operation like the personal path does", async () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "issues.transition",
        { issueKey: "PROJ-1" },
      ),
    ).rejects.toBeInstanceOf(IntegrationError);
  });
});
