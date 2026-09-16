import { resolveConfig } from "../src/config.js";
import { IntegrationError } from "../src/errors.js";
import {
  attachmentBinaryProblem,
  attachmentByteLimit,
  attachmentName,
  assertReadableSize,
} from "../src/providers/testit/attachments.js";
import {
  resolveTestitConfig,
  testitInstance,
  type TestitFlags,
} from "../src/providers/testit/config.js";
import { TestitProvider } from "../src/providers/testit/index.js";
import { capped, paged } from "../src/providers/testit/operations.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

const INSTANCE = {
  id: "cloud",
  label: "Test IT Cloud",
  baseUrl: "https://team.example.testit.software",
};
const SECOND = {
  id: "tms",
  label: "TMS",
  baseUrl: "https://tms.corp.example",
};

/** A deployment with one configured installation unless a test says otherwise. */
function config(testit: Partial<TestitFlags> = {}) {
  return resolveConfig({
    testit: { instances: [{ ...INSTANCE }], ...testit },
  });
}

interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
  readonly headers?: Record<string, string>;
}

interface StubCall {
  readonly url: URL;
  readonly init: RequestInit;
}

function stub(handler: (url: URL) => StubResult) {
  const calls: StubCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    const result = handler(url);
    const headers = new Headers(result.headers ?? {});
    const status = result.status ?? 200;
    if (result.json !== undefined) {
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(result.json), { status, headers });
    }
    headers.set("content-type", headers.get("content-type") ?? "text/plain");
    return new Response(result.text ?? "", { status, headers });
  };
  return { calls, fetcher };
}

/** Credential plaintext as `parseCredential` stores it. */
function credentialFor(
  fetcher: typeof fetch,
  testit: Partial<TestitFlags> = {},
  options: Readonly<Record<string, string>> = { instanceId: INSTANCE.id },
) {
  return new TestitProvider(config(testit), fetcher).parseCredential(
    TOKEN,
    options,
  ).credential;
}

const PROJECTS = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Mobile" },
];

describe("testit instance list", () => {
  it("canonicalizes what the operator configured", () => {
    const flags = resolveTestitConfig({
      instances: [
        {
          id: "cloud",
          label: "",
          baseUrl: "https://Team.Example.TESTIT/root/",
        },
      ],
    });
    expect(flags.instances).toEqual([
      {
        id: "cloud",
        label: "team.example.testit",
        baseUrl: "https://team.example.testit/root",
      },
    ]);
  });

  it("fails loudly on an operator typo instead of dropping an instance", () => {
    expect(() =>
      resolveTestitConfig({
        instances: [{ id: "Cloud", label: "Cloud", baseUrl: "https://x" }],
      }),
    ).toThrow(/instances\[0\]\.id/u);
    expect(() =>
      resolveTestitConfig({
        instances: [
          { id: "a", label: "A", baseUrl: "https://x" },
          { id: "a", label: "A again", baseUrl: "https://y" },
        ],
      }),
    ).toThrow(/duplicate/u);
    expect(() =>
      resolveTestitConfig({
        instances: [{ id: "a", label: "A", baseUrl: "team.example" }],
      }),
    ).toThrow(/absolute URL/u);
    expect(() =>
      resolveTestitConfig({
        instances: [
          { id: "a", label: "A", baseUrl: "https://user:pw@team.example" },
        ],
      }),
    ).toThrow(/credentials/u);
    expect(() =>
      resolveTestitConfig({
        instances: [
          { id: "a", label: "A", baseUrl: "https://team.example?x=1" },
        ],
      }),
    ).toThrow(/no credentials or query/u);
  });

  it("refuses plain HTTP unless the deployment is a development one", () => {
    expect(() =>
      resolveTestitConfig({
        instances: [
          { id: "lab", label: "Lab", baseUrl: "http://tms.corp.example" },
        ],
      }),
    ).toThrow(/needs HTTPS/u);
    expect(
      resolveTestitConfig({
        allowInsecureHttp: true,
        instances: [
          { id: "lab", label: "Lab", baseUrl: "http://tms.corp.example" },
        ],
      }).instances[0]?.baseUrl,
    ).toBe("http://tms.corp.example");
  });

  it("keeps the budgets consistent", () => {
    expect(() =>
      resolveTestitConfig({ defaultResults: 200, maxResults: 100 }),
    ).toThrow(/defaultResults/u);
    expect(() =>
      resolveTestitConfig({
        defaultAttachmentBytes: 2_048,
        maxAttachmentBytes: 1_024,
      }),
    ).toThrow(/defaultAttachmentBytes/u);
    expect(testitInstance(resolveTestitConfig({}), "cloud")).toBeUndefined();
  });
});

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

describe("testit request building", () => {
  it("pages with Skip and Take and reports the page back", async () => {
    const { calls, fetcher } = stub(() => ({
      json: PROJECTS,
      headers: { "pagination-total-items": "7" },
    }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    const first = (await provider.execute({ credential }, "projects.list", {
      offset: 0,
      limit: 5,
    })) as Record<string, unknown>;
    expect(calls[0]?.url.searchParams.get("Skip")).toBe("0");
    expect(calls[0]?.url.searchParams.get("Take")).toBe("5");
    expect(first["pagination"]).toEqual({
      offset: 0,
      limit: 5,
      returned: 1,
      total: 7,
      hasMore: true,
    });
    await provider.execute({ credential }, "projects.list", { offset: 2 });
    expect(calls[1]?.url.searchParams.get("Skip")).toBe("2");
    // An unasked limit is the deployment default, not the hard cap.
    expect(calls[1]?.url.searchParams.get("Take")).toBe("20");
  });

  it("clamps an oversized limit instead of refusing it", async () => {
    const { calls, fetcher } = stub(() => ({ json: [] }));
    const provider = new TestitProvider(config(), fetcher);
    await provider.execute(
      { credential: credentialFor(fetcher) },
      "testRuns.list",
      {
        projectId: PROJECTS[0]?.id,
        limit: 5_000,
      },
    );
    expect(calls[0]?.url.searchParams.get("Take")).toBe("50");
  });

  it("sends all four run state flags, as that endpoint requires", async () => {
    const { calls, fetcher } = stub(() => ({ json: [] }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    // `Failed` is a result outcome, not a run state: the typed filter refuses it
    // before any request is built.
    await expect(
      provider.execute({ credential }, "testRuns.list", {
        projectId: PROJECTS[0]?.id,
        states: ["Failed"],
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toHaveLength(0);

    await provider.execute({ credential }, "testRuns.list", {
      projectId: PROJECTS[0]?.id,
    });
    const query = calls[0]?.url.searchParams;
    expect([
      query?.get("notStarted"),
      query?.get("inProgress"),
      query?.get("stopped"),
      query?.get("completed"),
    ]).toEqual(["true", "true", "true", "true"]);

    await provider.execute({ credential }, "testRuns.list", {
      projectId: PROJECTS[0]?.id,
      states: ["InProgress", "Stopped"],
      createdFrom: "2026-09-01T00:00:00Z",
      createdTo: "2026-09-17",
      testPlanId: PROJECTS[0]?.id,
    });
    const filtered = calls[1]?.url.searchParams;
    expect(filtered?.get("notStarted")).toBe("false");
    expect(filtered?.get("inProgress")).toBe("true");
    expect(filtered?.get("stopped")).toBe("true");
    expect(filtered?.get("completed")).toBe("false");
    expect(filtered?.get("createdDateFrom")).toBe("2026-09-01T00:00:00Z");
    expect(filtered?.get("createdDateTo")).toBe("2026-09-17");
    expect(filtered?.get("testPlanId")).toBe(PROJECTS[0]?.id);
  });

  it("refuses an identifier that is not an identifier, without a request", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    for (const value of ["../projects", "a/b", "", "x".repeat(65), 42]) {
      await expect(
        provider.execute({ credential }, "workItems.get", {
          workItemId: value,
        }),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(0);
  });

  it("addresses each read by its documented path", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    const id = PROJECTS[0]?.id ?? "";
    const paths: readonly [string, Record<string, unknown>][] = [
      ["projects.get", { projectId: id }],
      ["sections.list", { projectId: id }],
      ["workItems.list", { projectId: id }],
      ["workItems.get", { workItemId: id }],
      ["workItems.history", { workItemId: id }],
      ["workItems.comments", { workItemId: id }],
      ["workItems.testResults", { workItemId: id }],
      ["testPlans.list", { projectId: id }],
      ["testPlans.get", { testPlanId: id }],
      ["testPlans.summary", { testPlanId: id }],
      ["testRuns.get", { testRunId: id }],
      ["testRuns.results", { testRunId: id }],
      ["testResults.get", { testResultId: id }],
      ["testResults.attachments", { testResultId: id }],
      ["attachments.metadata", { attachmentId: id }],
      ["autoTests.get", { autoTestId: id }],
      ["configurations.list", { projectId: id }],
    ];
    for (const [operation, input] of paths) {
      await provider.execute({ credential }, operation, input);
    }
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      `/api/v2/projects/${id}`,
      `/api/v2/projects/${id}/sections`,
      `/api/v2/projects/${id}/workItems`,
      `/api/v2/workItems/${id}`,
      `/api/v2/workItems/${id}/history`,
      `/api/v2/workItems/${id}/comments`,
      `/api/v2/workItems/${id}/testResults/history`,
      `/api/v2/projects/${id}/testPlans`,
      `/api/v2/testPlans/${id}`,
      `/api/v2/testPlans/${id}/summaries`,
      `/api/v2/testRuns/${id}`,
      `/api/v2/testRuns/${id}/testPoints/results`,
      `/api/v2/testResults/${id}`,
      `/api/v2/testResults/${id}/attachments`,
      `/api/v2/attachments/${id}/metadata`,
      `/api/v2/autoTests/${id}`,
      `/api/v2/projects/${id}/configurations`,
    ]);
    expect(calls.every(({ init }) => init.method === "GET")).toBe(true);
    expect(calls.every(({ init }) => init.redirect === "error")).toBe(true);
  });

  it("refuses an operation the catalog does not declare, without a request", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    for (const operation of [
      "raw_rest",
      "search.global",
      "workItems.create",
      "workItems.search",
      "testRuns.statistics",
      "attachments.upload",
      "workItems.like",
      "projects.purge",
    ]) {
      await expect(
        provider.execute({ credential }, operation, {}),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(0);
  });
});

describe("testit list envelopes", () => {
  it("reports the upstream total when the header carries it", () => {
    expect(paged([1, 2], { skip: 0, take: 2, total: 9 }, 2, 0)).toEqual({
      items: [1, 2],
      pagination: { offset: 0, limit: 2, returned: 2, total: 9, hasMore: true },
    });
    expect(paged([1], { skip: 8, take: 2, total: 9 }, 2, 8)).toEqual({
      items: [1],
      pagination: {
        offset: 8,
        limit: 2,
        returned: 1,
        total: 9,
        hasMore: false,
      },
    });
  });

  it("admits that a full page without a total may continue", () => {
    expect(paged([1, 2], undefined, 2, 0)).toEqual({
      items: [1, 2],
      pagination: { offset: 0, limit: 2, returned: 2, hasMore: true },
    });
    expect(paged([1], undefined, 2, 0)).toEqual({
      items: [1],
      pagination: { offset: 0, limit: 2, returned: 1, hasMore: false },
    });
  });

  it("cuts a collection upstream answers whole and says so", () => {
    expect(capped([1, 2, 3], 2)).toEqual({
      items: [1, 2],
      truncated: true,
      pagination: { limit: 2, returned: 2 },
    });
    expect(capped([1], 2)).toEqual({
      items: [1],
      truncated: false,
      pagination: { limit: 2, returned: 1 },
    });
  });
});

describe("testit response shaping", () => {
  const WORK_ITEM = {
    id: "22222222-2222-2222-2222-222222222222",
    globalId: 12,
    versionId: "v1",
    versionNumber: 3,
    name: "Login with a valid password",
    entityTypeName: "TestCases",
    projectId: PROJECTS[0]?.id,
    sectionId: "33333333-3333-3333-3333-333333333333",
    state: "Ready",
    priority: "High",
    sourceType: "Manual",
    isAutomated: false,
    isDeleted: false,
    duration: 60_000,
    tags: [{ name: "auth" }],
    description: "Steps a QA engineer wrote.",
    attributes: { Layer: "UI" },
    steps: [
      {
        id: "step-1",
        action: "Open the login page",
        expected: "The form is shown",
        testData: "user=qa",
        comments: "Watch the banner",
      },
    ],
    attachments: [
      { id: "att-1", name: "log.txt", size: 12, type: "text/plain" },
    ],
    autoTests: [
      { id: "auto-1", name: "LoginTest", externalId: "ns.LoginTest" },
    ],
    links: [{ id: "link-1", title: "Spec", url: "https://example.test/spec" }],
    unknownFieldFromANewerServer: "tolerated",
  };

  it("hands a work item over with its text as untrusted blocks", async () => {
    const { fetcher } = stub(() => ({ json: WORK_ITEM }));
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "workItems.get",
      { workItemId: WORK_ITEM.id },
    )) as Record<string, unknown>;
    expect(answer["name"]).toBe("Login with a valid password");
    expect(answer["state"]).toBe("Ready");
    expect(answer["tags"]).toEqual(["auth"]);
    expect(answer["durationMs"]).toBe(60_000);
    expect(answer["untrustedContent"]).toEqual({
      description: {
        format: "plain",
        text: "Steps a QA engineer wrote.",
        totalChars: 26,
        truncated: false,
      },
    });
    expect(answer["steps"]).toEqual([
      {
        id: "step-1",
        action: {
          format: "plain",
          text: "Open the login page",
          totalChars: 19,
          truncated: false,
        },
        expected: {
          format: "plain",
          text: "The form is shown",
          totalChars: 17,
          truncated: false,
        },
        testData: {
          format: "plain",
          text: "user=qa",
          totalChars: 7,
          truncated: false,
        },
        comments: {
          format: "plain",
          text: "Watch the banner",
          totalChars: 16,
          truncated: false,
        },
      },
    ]);
    expect(answer["attachments"]).toEqual([
      {
        id: "att-1",
        name: "log.txt",
        type: "text/plain",
        size: 12,
      },
    ]);
    expect(answer["autoTests"]).toEqual([
      { id: "auto-1", name: "LoginTest", externalId: "ns.LoginTest" },
    ]);
    expect(JSON.stringify(answer)).not.toContain(
      "unknownFieldFromANewerServer",
    );
  });

  it("bounds the text it hands over and marks the cut", async () => {
    const long = "x".repeat(2_500);
    const { fetcher } = stub(() => ({
      json: { ...WORK_ITEM, description: long },
    }));
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "workItems.get",
      { workItemId: WORK_ITEM.id },
    )) as {
      readonly untrustedContent: {
        readonly description: Record<string, unknown>;
      };
    };
    expect(answer.untrustedContent.description).toEqual({
      format: "plain",
      text: "x".repeat(2_000),
      totalChars: 2_500,
      truncated: true,
    });
  });

  it("narrows a work item page and hides deleted rows by default", async () => {
    const rows = [
      { ...WORK_ITEM, name: "Login", isDeleted: false },
      { ...WORK_ITEM, id: "other", name: "Logout", isDeleted: false },
      { ...WORK_ITEM, id: "gone", name: "Login legacy", isDeleted: true },
      {
        ...WORK_ITEM,
        id: "list",
        name: "Login checklist",
        entityTypeName: "CheckLists",
      },
    ];
    const { fetcher } = stub(() => ({ json: rows }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    const named = (await provider.execute({ credential }, "workItems.list", {
      projectId: WORK_ITEM.projectId,
      query: "login",
    })) as { readonly items: readonly Record<string, unknown>[] };
    expect(named.items.map((item) => item["name"])).toEqual([
      "Login",
      "Login checklist",
    ]);
    const typed = (await provider.execute({ credential }, "workItems.list", {
      projectId: WORK_ITEM.projectId,
      entityType: "CheckLists",
    })) as { readonly items: readonly Record<string, unknown>[] };
    expect(typed.items.map((item) => item["entityTypeName"])).toEqual([
      "CheckLists",
    ]);
    const low = (await provider.execute({ credential }, "workItems.list", {
      projectId: WORK_ITEM.projectId,
      priority: "Low",
    })) as { readonly items: readonly Record<string, unknown>[] };
    expect(low.items).toEqual([]);
    const deleted = (await provider.execute({ credential }, "workItems.list", {
      projectId: WORK_ITEM.projectId,
      includeDeleted: true,
    })) as { readonly items: readonly Record<string, unknown>[] };
    expect(deleted.items).toHaveLength(4);
  });

  it("reports a change log as field moves", async () => {
    const { fetcher } = stub(() => ({
      json: [
        {
          id: "change-1",
          workItemId: WORK_ITEM.id,
          oldVersionId: "v1",
          newVersionId: "v2",
          createdById: "user-1",
          createdDate: "2026-09-16T10:00:00Z",
          workItemChangedFields: {
            name: { oldValue: "Login", newValue: "Login with a password" },
            state: { oldValue: "NeedsWork", newValue: "Ready" },
            untouched: {},
          },
        },
      ],
    }));
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "workItems.history",
      { workItemId: WORK_ITEM.id },
    )) as { readonly items: readonly Record<string, unknown>[] };
    expect(answer.items[0]).toMatchObject({
      id: "change-1",
      oldVersionId: "v1",
      newVersionId: "v2",
      createdById: "user-1",
      fields: [
        { field: "name", from: "Login", to: "Login with a password" },
        { field: "state", from: "NeedsWork", to: "Ready" },
      ],
    });
  });

  it("keeps a run card about the run, never about its results", async () => {
    const { fetcher } = stub(() => ({
      json: [
        {
          id: "run-1",
          name: "Regression 5.4",
          projectId: WORK_ITEM.projectId,
          stateName: "Completed",
          status: { name: "Failed", code: "Failed", type: "Failed" },
          runCount: 2,
          createdDate: "2026-09-16T09:00:00Z",
          createdByUserName: "Alice",
          tags: ["regression"],
          testResults: [{ id: "result-1", outcome: "Failed" }],
        },
      ],
      headers: { "pagination-total-items": "3" },
    }));
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "testRuns.list",
      { projectId: WORK_ITEM.projectId },
    )) as { readonly items: readonly Record<string, unknown>[] };
    expect(answer.items[0]).toMatchObject({
      id: "run-1",
      name: "Regression 5.4",
      stateName: "Completed",
      status: { name: "Failed", code: "Failed", type: "Failed" },
      runCount: 2,
      tags: ["regression"],
    });
    expect(answer.items[0]).not.toHaveProperty("testResults");
    expect(JSON.stringify(answer)).not.toContain("result-1");
  });

  it("marks a run's messages and traces as untrusted text", async () => {
    const { fetcher } = stub(() => ({
      json: {
        id: "result-1",
        testRunId: "run-1",
        testPointId: "point-1",
        configurationId: "config-1",
        workItemVersionId: "v3",
        outcome: "Failed",
        durationInMs: 1_500,
        message: "AssertionError: expected 200",
        traces: "at LoginTest.run(LoginTest.java:42)",
        parameters: { browser: "chrome" },
        stepResults: [{ stepId: "step-1", outcome: "Failed" }],
        autoTest: { id: "auto-1", name: "LoginTest", namespace: "ns" },
      },
    }));
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "testResults.get",
      { testResultId: "result-1" },
    )) as Record<string, unknown>;
    expect(answer["outcome"]).toBe("Failed");
    expect(answer["durationMs"]).toBe(1_500);
    expect(answer["parameters"]).toEqual({ browser: "chrome" });
    expect(answer["stepResults"]).toEqual([
      { stepId: "step-1", outcome: "Failed" },
    ]);
    expect(answer["autoTest"]).toEqual({
      id: "auto-1",
      name: "LoginTest",
      namespace: "ns",
    });
    expect(answer["untrustedContent"]).toMatchObject({
      message: { text: "AssertionError: expected 200" },
      traces: { text: "at LoginTest.run(LoginTest.java:42)" },
    });
  });

  it("answers the connection probe with what it proved and no identity", async () => {
    const { fetcher } = stub(() => ({
      json: PROJECTS,
      headers: { "pagination-total-items": "4" },
    }));
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "connection.get",
      {},
    )) as Record<string, unknown>;
    expect(answer).toEqual({
      apiGeneration: "v2",
      instance: INSTANCE.label,
      baseUrl: INSTANCE.baseUrl,
      canReadProjects: true,
      projectsVisible: 4,
    });
  });
});

describe("testit attachment policy", () => {
  it("refuses kinds that are not text and keeps the name it was given", () => {
    expect(attachmentBinaryProblem("report.txt")).toBeUndefined();
    expect(attachmentBinaryProblem("stack.log")).toBeUndefined();
    expect(attachmentBinaryProblem("screen.png")).toMatch(/never inlined/u);
    expect(attachmentBinaryProblem("build.zip")).toMatch(/never inlined/u);
    expect(attachmentBinaryProblem("spec.pdf")).toMatch(/never inlined/u);
    expect(attachmentBinaryProblem("id_rsa")).toBeUndefined();
    expect(attachmentName("  report.txt  ")).toBe("report.txt");
    expect(attachmentName(undefined)).toBe("");
  });

  it("bounds the byte budget by the deployment", () => {
    const flags = resolveTestitConfig({
      defaultAttachmentBytes: 4_096,
      maxAttachmentBytes: 8_192,
    });
    expect(attachmentByteLimit(undefined, flags)).toBe(4_096);
    expect(attachmentByteLimit(2_048, flags)).toBe(2_048);
    expect(attachmentByteLimit(64_000, flags)).toBe(8_192);
  });

  it("refuses a file Test IT already described as too large", () => {
    expect(() => assertReadableSize(9_000, 8_192)).toThrow(
      /larger than the attachment byte budget/u,
    );
    expect(() => assertReadableSize(8_192, 8_192)).not.toThrow();
    expect(() => assertReadableSize(undefined, 8_192)).not.toThrow();
  });

  it("describes the file itself before downloading it", async () => {
    const { calls, fetcher } = stub((url) => {
      if (url.pathname.endsWith("/metadata")) {
        return {
          json: {
            id: "att-1",
            name: "screen.png",
            size: 20_480,
            type: "image/png",
          },
        };
      }
      return {
        text: "never requested",
        headers: { "content-type": "image/png" },
      };
    });
    const provider = new TestitProvider(config(), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor(fetcher) },
        "attachments.text",
        {
          attachmentId: "att-1",
        },
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    // Only the metadata call was made: the refusal happened before the download.
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/api/v2/attachments/att-1/metadata",
    ]);
  });

  it("refuses an oversized file from its declared size, before the download", async () => {
    const { calls, fetcher } = stub((url) => {
      if (url.pathname.endsWith("/metadata")) {
        return {
          json: { name: "huge.log", size: 999_999, type: "text/plain" },
        };
      }
      return { text: "never requested" };
    });
    const provider = new TestitProvider(config(), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor(fetcher) },
        "attachments.text",
        {
          attachmentId: "att-1",
          maxBytes: 2_048,
        },
      ),
    ).rejects.toMatchObject({ code: "ResultTooLarge" });
    expect(calls).toHaveLength(1);
  });

  it("redacts a secret a log left behind and bounds the body", async () => {
    const body = `setup ok\npassword=hunter2\n${"line\n".repeat(50)}`;
    const { calls, fetcher } = stub((url) => {
      if (url.pathname.endsWith("/metadata")) {
        return { json: { name: "run.log", size: 128, type: "text/plain" } };
      }
      return { text: body, headers: { "content-type": "text/plain" } };
    });
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "attachments.text",
      { attachmentId: "att-1", maxBytes: 1_024 },
    )) as Record<string, unknown>;
    expect(answer["name"]).toBe("run.log");
    expect(answer["declaredBytes"]).toBe(128);
    expect(answer["binary"]).toBe(false);
    const content = answer["untrustedContent"] as {
      readonly text: string;
      readonly truncated: boolean;
    };
    expect(content.text).toContain("password=[REDACTED]");
    expect(content.text).not.toContain("hunter2");
    expect(calls[1]?.url.pathname).toBe("/api/v2/attachments/att-1");
  });

  it("answers a binary body with its size and no content", async () => {
    const { fetcher } = stub((url) => {
      if (url.pathname.endsWith("/metadata")) {
        return {
          json: {
            name: "dump.bin.dat",
            size: 4,
            type: "application/octet-stream",
          },
        };
      }
      return {
        text: "\u0000\u0001\u0002\u0003",
        headers: { "content-type": "application/octet-stream" },
      };
    });
    const provider = new TestitProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "attachments.text",
      { attachmentId: "att-1" },
    )) as Record<string, unknown>;
    expect(answer["binary"]).toBe(true);
    expect(answer).not.toHaveProperty("untrustedContent");
  });
});

describe("testit upstream failures", () => {
  const cases: readonly [number, string][] = [
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [409, "InvalidRequest"],
    [413, "ResultTooLarge"],
    [422, "InvalidRequest"],
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
    [503, "ProviderUnavailable"],
  ];

  it("maps statuses onto the provider error model without upstream bodies", async () => {
    for (const [status, code] of cases) {
      const { fetcher } = stub(() => ({
        status,
        json: { detail: `internal host tms.corp.example with ${TOKEN}` },
      }));
      const provider = new TestitProvider(config({ retries: 0 }), fetcher);
      const credential = credentialFor(fetcher, { retries: 0 });
      await expect(
        provider.execute({ credential }, "projects.list", {}),
      ).rejects.toMatchObject({ code });
      try {
        await provider.execute({ credential }, "projects.list", {});
      } catch (error) {
        expect((error as IntegrationError).message).not.toContain("internal");
        expect((error as IntegrationError).message).not.toContain(TOKEN);
      }
    }
  });

  it("retries a throttled read but not a refused one", async () => {
    const throttled = stub(() => ({
      status: 429,
      json: {},
      headers: { "retry-after": "0" },
    }));
    const provider = new TestitProvider(
      config({ retries: 1 }),
      throttled.fetcher,
    );
    await expect(
      provider.execute(
        { credential: credentialFor(throttled.fetcher, { retries: 1 }) },
        "projects.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "RateLimited" });
    expect(throttled.calls).toHaveLength(2);

    const denied = stub(() => ({ status: 403, json: {} }));
    const strict = new TestitProvider(config({ retries: 3 }), denied.fetcher);
    await expect(
      strict.execute(
        { credential: credentialFor(denied.fetcher, { retries: 3 }) },
        "projects.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(denied.calls).toHaveLength(1);
  });

  it("keeps a timeout and a TLS failure apart from an unreachable host", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    const slow = new TestitProvider(
      resolveConfig({
        timeoutMs: 30,
        testit: { instances: [{ ...INSTANCE }], retries: 0 },
      }),
      hanging,
    );
    await expect(
      slow.execute(
        {
          credential: new TestitProvider(
            config({ retries: 0 }),
            hanging,
          ).parseCredential(TOKEN, { instanceId: "cloud" }).credential,
        },
        "projects.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });

    const untrusted: typeof fetch = async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("self signed certificate"), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        }),
      });
    };
    const tls = new TestitProvider(config({ retries: 0 }), untrusted);
    await expect(
      tls.execute(
        { credential: credentialFor(untrusted, { retries: 0 }) },
        "projects.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "TlsFailure" });
  });
});
