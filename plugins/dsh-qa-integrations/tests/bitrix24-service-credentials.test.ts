import {
  Bitrix24Provider,
  BITRIX_OPERATIONS,
  BOUNDARY,
  evaluateServiceOperation,
  config,
  plaintext,
  PORTAL,
  profile,
  resolveBitrix24Config,
  serviceContext,
  stub,
  UNCLASSIFIED_OPERATION,
} from "./bitrix24-service.helpers.js";

describe("Bitrix24 managed service credentials", () => {
  it("classifies every catalog operation", () => {
    for (const [operation, definition] of Object.entries(BITRIX_OPERATIONS)) {
      expect(definition.security).toBeDefined();
      expect(["read", "write", "admin"]).toContain(definition.security.effect);
      expect(["normal", "sensitive", "secret"]).toContain(
        definition.security.sensitivity,
      );
      expect(["allow", "deny"]).toContain(
        definition.security.serviceCredential,
      );
      // The variable is the table under test; the loop guard above is the
      // assertion. Referenced once so lint keeps the explicit dependency.
      void operation;
    }
  });

  it("classifies the people lookup as sensitive and refuses it through a service token", async () => {
    const { fetcher, calls } = stub(() => ({ json: [] }));
    const provider = new Bitrix24Provider(config(), fetcher);
    const metadata = provider.operationMetadata?.("user.list");
    expect(metadata).toMatchObject({
      effect: "read",
      sensitivity: "sensitive",
      serviceCredential: "deny",
    });
    const decision = evaluateServiceOperation({
      metadata: metadata ?? UNCLASSIFIED_OPERATION,
      capability: "user.read",
      profile: profile(),
      boundaryKind: provider.resourceBoundaryKind?.("user.list"),
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "SensitiveReadRequiresPersonalCredential",
    });

    // Defence in depth: the provider refuses on its own classification, so a
    // caller that reached it without the broker's decision — or a future broker
    // bug — still does not hand out the employee directory.
    await expect(
      provider.execute(
        { credential: plaintext(), ...serviceContext() },
        "user.list",
        {},
      ),
    ).rejects.toMatchObject({
      code: "SensitiveReadRequiresPersonalCredential",
    });
    expect(calls).toEqual([]);
  });

  it("refuses the write operation through a service token", async () => {
    const { fetcher, calls } = stub(() => ({ json: { result: 1 } }));
    const provider = new Bitrix24Provider(config(), fetcher);
    await expect(
      provider.execute(
        { credential: plaintext(), ...serviceContext() },
        "crm.timelineCommentAdd",
        { entityType: "deal", entityId: 7, comment: "hello" },
      ),
    ).rejects.toThrowError();
    expect(calls).toEqual([]);
  });

  it("refuses a portal outside the administrator boundary", async () => {
    const { fetcher, calls } = stub(() => ({ json: { result: [] } }));
    const provider = new Bitrix24Provider(config(), fetcher);
    await expect(
      provider.execute(
        {
          credential: JSON.stringify({
            webhookBaseUrl: `https://other.${PORTAL.split(".")[1] ?? "ru"}/rest/1/x`,
          }),
          ...serviceContext(),
        },
        "crm.get",
        { entityTypeId: 2, id: 7 },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // The refusal happens before anything is sent upstream.
    expect(calls).toEqual([]);
  });

  it("serves a CRM read inside the portal boundary", async () => {
    const { fetcher } = stub(() => ({
      json: { result: { item: { id: 7 } } },
    }));
    const provider = new Bitrix24Provider(config(), fetcher);
    await expect(
      provider.execute(
        { credential: plaintext(), ...serviceContext() },
        "crm.get",
        { entityTypeId: 2, id: 7 },
      ),
    ).resolves.toMatchObject({ item: { id: 7 } });
  });

  it("keeps the identity reads service-safe without a boundary membership check", async () => {
    const { fetcher } = stub(() => ({
      json: { result: { ID: "1", NAME: "Service" } },
    }));
    const provider = new Bitrix24Provider(config(), fetcher);
    expect(provider.resourceBoundaryKind?.("user.current")).toBeUndefined();
    await expect(
      provider.execute(
        { credential: plaintext(), ...serviceContext() },
        "user.current",
        {},
      ),
    ).resolves.toMatchObject({ ID: "1" });
  });

  it("reports capability service states: write unavailable, mixed reads sensitive", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new Bitrix24Provider(config(), fetcher);
    expect(provider.capabilityServiceState?.("crm.comment.write")).toBe(
      "unavailable",
    );
    expect(provider.capabilityServiceState?.("crm.read")).toBe("sensitive");
    expect(provider.capabilityServiceState?.("chat.read")).toBe("sensitive");
    expect(provider.capabilityServiceState?.("tasks.read")).toBe("available");
  });

  it("names the portal kind for boundary-required operations only", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new Bitrix24Provider(config(), fetcher);
    expect(provider.resourceBoundaryKind?.("crm.get")).toBe("portals");
    expect(provider.resourceBoundaryKind?.("user.current")).toBeUndefined();
    expect(provider.resourceBoundaryKind?.("nope.nope")).toBeUndefined();
  });

  it("resolves the instance portal with the single-instance default", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new Bitrix24Provider(config(), fetcher);
    expect(provider.instancePortal("corp")).toBe(PORTAL);
    expect(provider.instancePortal("")).toBe(PORTAL);
    expect(provider.instancePortal("missing")).toBeUndefined();
  });

  it("probes the managed webhook without changing upstream state", async () => {
    const { fetcher, calls } = stub((url) => {
      if (url.pathname.endsWith("/profile.json")) {
        return { json: { result: { ID: "42", NAME: "QA", LAST_NAME: "Bot" } } };
      }
      if (url.pathname.endsWith("/scope.json")) {
        return { json: { result: ["crm", "task"] } };
      }
      return { json: {} };
    });
    const provider = new Bitrix24Provider(config(), fetcher);
    const health = await provider.validateServiceCredential?.({
      credential: plaintext(),
      credentialSource: "service",
    });
    expect(health).toMatchObject({ status: "healthy" });
    expect(health?.upstreamIdentity).toMatchObject({ id: "42" });
    expect(health?.grantedScopes).toEqual(["crm", "task"]);
    expect(health?.warnings?.length ?? 0).toBeGreaterThan(0);
    for (const url of calls) {
      expect(url.pathname).toMatch(/\/(profile|scope)\.json$/u);
    }
  });

  it("maps an upstream probe failure onto a health status", async () => {
    const { fetcher } = stub(() => ({ status: 401, json: {} }));
    const provider = new Bitrix24Provider(config(), fetcher);
    const health = await provider.validateServiceCredential?.({
      credential: plaintext(),
      credentialSource: "service",
    });
    expect(health).toMatchObject({ status: "revoked" });
  });

  it("normalizes instance portals: URL, bare host, duplicates rejected", () => {
    const resolved = resolveBitrix24Config({
      instances: [
        { id: "a", label: "A", portal: "https://one.bitrix24.ru/" },
        { id: "b", label: "B", portal: "two.bitrix24.ru" },
      ],
    });
    expect(resolved.instances.map((instance) => instance.portal)).toEqual([
      "one.bitrix24.ru",
      "two.bitrix24.ru",
    ]);
    expect(() =>
      resolveBitrix24Config({
        instances: [
          { id: "a", label: "A", portal: "one.bitrix24.ru" },
          { id: "a", label: "A2", portal: "two.bitrix24.ru" },
        ],
      }),
    ).toThrowError(/duplicate/u);
    expect(() =>
      resolveBitrix24Config({
        instances: [{ id: "c", label: "C", portal: "not a host/path" }],
      }),
    ).toThrowError(/bare hostname/u);
  });

  it("keeps BOUNDARY shape portals-only", () => {
    expect(Object.keys(BOUNDARY)).toEqual(["portals"]);
  });

  it("reports the service decision for the unclassified operation as deny", () => {
    const decision = evaluateServiceOperation({
      metadata: UNCLASSIFIED_OPERATION,
      capability: "crm.read",
      profile: profile(),
      boundaryKind: "portals",
    });
    expect(decision).toMatchObject({ allowed: false });
  });
});
