import { TestitProvider } from "../../src/providers/testit/index.js";
import { INSTANCE, PROJECTS, config, credentialFor, stub } from "./shared.js";

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
