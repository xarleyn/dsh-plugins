import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IntegrationRepository } from "../src/repository.js";
import {
  PROFILE_INPUT,
  buildHarness,
  repositories,
} from "./service-credentials.helpers.js";
describe("managed service credentials: broker", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qa-integrations-service-"));
  afterAll(() => {
    for (const repository of repositories) repository.close();
    rmSync(root, { recursive: true, force: true });
  });
  it("keeps two users on one service credential with independent boundaries", async () => {
    const { broker, seen } = buildHarness(
      path.join(root, "users.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    const bob = { userId: "bob" };
    await broker.connect(alice, "acme", { token: "" });
    await broker.connect(bob, "acme", { token: "" });
    broker.setServiceSelection(bob, "acme", { projects: ["beta"] });

    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "beta" },
        sourceSessionId: "s-alice",
      }),
    ).resolves.toMatchObject({ data: { named: "beta" } });
    await expect(
      broker.call(bob, {
        provider: "acme",
        operation: "records.get",
        input: { project: "alpha" },
        sourceSessionId: "s-bob",
      }),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // Both calls spent the deployment's token, and neither was billed to the
    // other's binding.
    expect(
      seen.every((call) => call.credential.includes("service-token")),
    ).toBe(true);
  });

  it("audits the real principal and the credential source of every service call", async () => {
    const file = path.join(root, "audit.db");
    const { broker } = buildHarness(file, PROFILE_INPUT());
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "logs.get",
        input: { project: "alpha" },
        sourceSessionId: "s-alice",
      }),
    ).rejects.toMatchObject({
      code: "SensitiveReadRequiresPersonalCredential",
    });
    await broker.call(alice, {
      provider: "acme",
      operation: "records.get",
      input: { project: "alpha" },
      sourceSessionId: "s-alice",
    });
    const repository = repositories.at(-1);
    const audit = repository?.read().audit ?? [];
    const denied = audit.find((entry) => entry.operation === "logs.get");
    const allowed = audit.find((entry) => entry.operation === "records.get");
    expect(denied).toMatchObject({
      ownerUserId: "alice",
      credentialSource: "service",
      serviceProfileId: "acme-readonly",
      result: "denied",
    });
    expect(allowed).toMatchObject({
      ownerUserId: "alice",
      credentialSource: "service",
      serviceProfileId: "acme-readonly",
      sourceSessionId: "s-alice",
      result: "success",
    });
  });

  it("never falls back to the other credential after a refusal", async () => {
    const { broker, seen } = buildHarness(
      path.join(root, "switch.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };

    // Personal mode first: upstream refuses one read, and that refusal is the
    // answer. It is not a reason to try the deployment's account.
    const personal = await broker.connect(
      alice,
      "acme",
      { token: "https://acme.example/rest/1/personal-token" },
      { useServiceCredential: false },
    );
    expect(personal.credentialSource).toBe("personal");
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "forbidden" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(seen.every((call) => call.credentialSource === "personal")).toBe(
      true,
    );

    // The other direction: the service boundary refuses, and the personal
    // credential that is still stored does not step in.
    const service = await broker.setCredentialSource(alice, "acme", "service");
    expect(service.credentialSource).toBe("service");
    expect(service.credentialConfigured).toBe(true);
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "forbidden" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(seen.at(-1)?.credentialSource).toBe("service");
  });

  it("increments the binding revision on every credential-mode switch", async () => {
    const file = path.join(root, "revision.db");
    const { broker } = buildHarness(file, PROFILE_INPUT());
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    await broker.connect(
      alice,
      "acme",
      { token: "https://acme.example/rest/1/personal-token" },
      { useServiceCredential: false },
    );
    await broker.setCredentialSource(alice, "acme", "service");
    const repository = repositories.at(-1);
    expect(repository?.find(alice, "acme")?.bindingRevision).toBe(3);
  });

  it("repairs a capability a provider has since split, policy included", () => {
    const file = path.join(root, "repair.db");
    const repository = new IntegrationRepository(file);
    repositories.push(repository);
    const principal = { userId: "alice" };
    const encrypted = {
      id: "secret-1",
      ciphertext: "x",
      nonce: "x",
      authTag: "x",
      wrappedDek: "x",
      wrapNonce: "x",
      wrapAuthTag: "x",
      keyVersion: 1,
      secretType: "token" as const,
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repository.connect({
      principal,
      provider: "acme",
      secret: encrypted,
      tenantId: "acme.example",
      externalUserId: "11",
      displayName: "Personal Acme",
      capabilities: ["identity.read", "ci.read"],
    });
    repository.setPolicy(principal, "acme", "ci.read", "deny");

    repository.expandCapabilities({
      "ci.read": ["ci.metadata.read", "ci.logs.read"],
    });

    const integration = repository.find(principal, "acme");
    expect(integration?.capabilities).toEqual([
      "identity.read",
      "ci.metadata.read",
      "ci.logs.read",
    ]);
    // The policy the operator had set travels with the split, so a capability
    // that was off does not come back on.
    const policies = repositories.at(-1)?.read().policies ?? {};
    const id = integration?.id ?? "";
    expect(policies[`${id}:ci.metadata.read`]).toBe("deny");
    expect(policies[`${id}:ci.logs.read`]).toBe("deny");
    expect(policies[`${id}:ci.read`]).toBeUndefined();

    // Running it again changes nothing.
    const before = repository.read().integrations[0]?.capabilities;
    repository.expandCapabilities({
      "ci.read": ["ci.metadata.read", "ci.logs.read"],
    });
    expect(repository.read().integrations[0]?.capabilities).toEqual(before);
  });
});
