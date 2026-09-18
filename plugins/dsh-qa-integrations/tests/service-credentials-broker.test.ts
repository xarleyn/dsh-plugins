import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  it("starts a new connection on the managed credential", async () => {
    const { broker } = buildHarness(
      path.join(root, "default.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    const summary = await broker.connect(alice, "acme", { token: "" });
    expect(summary.credentialSource).toBe("service");
    expect(summary.externalAccountName).toBe("Acme Read-only");
    expect(summary.credentialConfigured).toBe(false);
    // A sensitive capability is not granted at all in service mode.
    expect(summary.capabilities).toEqual(["identity.read", "records.read"]);
    expect(summary.service).toMatchObject({
      available: true,
      label: "Acme Read-only",
      resources: { projects: ["alpha", "beta"] },
    });
  });

  it("keeps an existing connection on its own credential after an upgrade", async () => {
    const file = path.join(root, "upgrade.db");
    const before = buildHarness(file, { enabled: true, profiles: [] });
    const alice = { userId: "alice" };
    const bob = { userId: "bob" };
    for (const principal of [alice, bob]) {
      await before.broker.connect(principal, "acme", {
        token: `https://acme.example/rest/1/token-${principal.userId}`,
      });
    }
    expect(before.broker.summary(alice, "acme").credentialSource).toBe(
      "personal",
    );
    await before.broker.call(alice, {
      provider: "acme",
      operation: "records.get",
      input: { project: "gamma" },
      sourceSessionId: "s1",
    });

    // The same store, now served by a deployment that publishes a managed
    // credential. The rows that already exist keep the source they stored: an
    // upgrade never moves a user onto the shared account on its own.
    const after = buildHarness(file, PROFILE_INPUT());
    expect(after.broker.summary(alice, "acme").credentialSource).toBe(
      "personal",
    );
    await after.broker.call(alice, {
      provider: "acme",
      operation: "records.get",
      input: { project: "gamma" },
      sourceSessionId: "s1",
    });
    const call = after.seen.at(-1);
    expect(call?.credentialSource).toBe("personal");
    expect(call?.credential).toContain("token-alice");

    // A connection made after the upgrade does start on it.
    await after.broker.disconnect(bob, "acme");
    const connected = await after.broker.connect(bob, "acme", { token: "" });
    expect(connected.credentialSource).toBe("service");
  });

  it("refuses a write, a sensitive read and an unclassified operation in service mode", async () => {
    const { broker, seen } = buildHarness(
      path.join(root, "ceiling.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });

    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.write",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({
      code: "OperationNotAllowedWithServiceCredential",
    });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "logs.get",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({
      code: "SensitiveReadRequiresPersonalCredential",
    });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.unclassified",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({
      code: "OperationNotAllowedWithServiceCredential",
    });
    // Nothing reached the provider: the ceiling is checked before the call.
    expect(seen).toEqual([]);
  });

  it("holds a service call inside the administrator boundary", async () => {
    const { broker } = buildHarness(
      path.join(root, "boundary.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "gamma" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // A refusal the provider reached is still a policy decision, not a failure:
    // the trail has to read as one.
    expect(repositories.at(-1)?.read().audit.at(-1)).toMatchObject({
      result: "denied",
      credentialSource: "service",
    });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).resolves.toMatchObject({ data: { named: "alpha" } });
  });

  it("lets a user narrow the boundary but never widen it", async () => {
    const { broker, seen } = buildHarness(
      path.join(root, "narrow.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    const summary = broker.setServiceSelection(alice, "acme", {
      projects: ["gamma", "alpha"],
    });
    // gamma was never in the administrator's list, so it is dropped rather
    // than stored.
    expect(summary.service?.selection).toEqual({ projects: ["alpha"] });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "beta" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).resolves.toMatchObject({ data: { named: "alpha" } });
    expect(seen.at(-1)?.boundary).toEqual({ projects: ["alpha"] });
  });

  it("tells the caller when the requested credential does not exist", async () => {
    const { broker } = buildHarness(path.join(root, "absent.db"), {
      enabled: true,
      profiles: [],
    });
    const alice = { userId: "alice" };
    await expect(
      broker.connect(
        alice,
        "acme",
        { token: "" },
        { useServiceCredential: true },
      ),
    ).rejects.toMatchObject({ code: "ServiceCredentialUnavailable" });
  });
});
