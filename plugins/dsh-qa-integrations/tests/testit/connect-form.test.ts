import { TestitProvider } from "../../src/providers/testit/index.js";
import {
  INSTANCE,
  PROJECTS,
  SECOND,
  TOKEN,
  config,
  credentialFor,
  stub,
} from "./shared.js";

describe("testit connect form", () => {
  it("keeps the token and the configured instance, and never a host", () => {
    const { fetcher } = stub(() => ({ json: PROJECTS }));
    const parsed = new TestitProvider(config(), fetcher).parseCredential(
      TOKEN,
      { instanceId: INSTANCE.id },
    );
    expect(JSON.parse(parsed.credential)).toEqual({
      instanceId: "cloud",
      token: TOKEN,
    });
    expect(parsed.portal).toBe(INSTANCE.baseUrl);
    expect(parsed.credential).not.toContain("testit.software");
  });

  it("refuses a pasted URL, a short string and a space inside the token", () => {
    const { fetcher } = stub(() => ({ json: PROJECTS }));
    const provider = new TestitProvider(config(), fetcher);
    for (const raw of [
      "https://team.example.testit.software",
      "short",
      `${TOKEN} ${TOKEN}`,
    ]) {
      expect(() =>
        provider.parseCredential(raw, { instanceId: "cloud" }),
      ).toThrow(/Use a Test IT API token/u);
    }
  });

  it("fails closed when the instance is unknown, unconfigured or ambiguous", () => {
    const { fetcher } = stub(() => ({ json: PROJECTS }));
    const unknown = new TestitProvider(config(), fetcher);
    expect(() =>
      unknown.parseCredential(TOKEN, { instanceId: "nope" }),
    ).toThrow(/Unknown Test IT instance/u);
    const none = new TestitProvider(config({ instances: [] }), fetcher);
    expect(() => none.parseCredential(TOKEN)).toThrow(
      /No Test IT instance is configured/u,
    );
    const two = new TestitProvider(
      config({ instances: [{ ...INSTANCE }, { ...SECOND }] }),
      fetcher,
    );
    expect(() => two.parseCredential(TOKEN)).toThrow(
      /Choose a Test IT instance/u,
    );
  });

  it("re-resolves the address from config on every call", async () => {
    const { calls: configured, fetcher } = stub(() => ({ json: PROJECTS }));
    const credential = credentialFor(fetcher);
    await new TestitProvider(config(), fetcher).execute(
      { credential },
      "projects.list",
      {},
    );
    expect(configured).toHaveLength(1);
    // The same credential against a deployment that no longer configures the
    // instance fails closed instead of dialling anything.
    const { calls: empty, fetcher: other } = stub(() => ({ json: PROJECTS }));
    await expect(
      new TestitProvider(config({ instances: [] }), other).execute(
        { credential },
        "projects.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
    expect(empty).toHaveLength(0);
  });
});

describe("testit connection validation", () => {
  it("proves the instance and the token with the documented probe", async () => {
    const { calls, fetcher } = stub(() => ({
      json: PROJECTS,
      headers: { "pagination-total-items": "7" },
    }));
    const provider = new TestitProvider(config(), fetcher);
    const validation = await provider.validate({
      credential: credentialFor(fetcher),
    });
    expect(calls.map(({ url }) => url.pathname)).toEqual(["/api/v2/projects"]);
    expect(calls[0]?.url.searchParams.get("Take")).toBe("1");
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: `PrivateToken ${TOKEN}`,
    });
    expect(JSON.stringify(calls.map(({ url }) => url.href))).not.toContain(
      TOKEN,
    );
    expect(validation).toEqual({
      tenantId: INSTANCE.baseUrl,
      externalUserId: "",
      displayName: "Test IT Cloud · Test IT API v2, проектов видно: 7",
      capabilities: [
        "projects.read",
        "sections.read",
        "workItems.read",
        "history.read",
        "comments.read",
        "testPlans.read",
        "testRuns.read",
        "testResults.read",
        "autoTests.read",
        "attachments.read",
        "configurations.read",
      ],
    });
  });

  it("accepts an empty project list as a valid authorization result", async () => {
    const { fetcher } = stub(() => ({ json: [] }));
    const provider = new TestitProvider(config(), fetcher);
    const validation = await provider.validate({
      credential: credentialFor(fetcher),
    });
    expect(validation.displayName).toContain("проектов видно: 0");
  });

  it("narrows the capabilities to the deployment switches", async () => {
    const { fetcher } = stub(() => ({ json: PROJECTS }));
    const provider = new TestitProvider(
      config({ attachmentsRead: false, commentsRead: false }),
      fetcher,
    );
    const validation = await provider.validate({
      credential: credentialFor(fetcher, {
        attachmentsRead: false,
        commentsRead: false,
      }),
    });
    expect(validation.capabilities).not.toContain("attachments.read");
    expect(validation.capabilities).not.toContain("comments.read");
    expect(validation.capabilities).toContain("projects.read");
  });
});
