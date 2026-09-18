import { credentialFor, providerFor, stub } from "./shared.js";

describe("jira project, fields and transitions", () => {
  it("answers one project with its permalink", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        id: "10",
        key: "PROJ",
        name: "Medical",
        projectTypeKey: "software",
        simplified: false,
        isPrivate: true,
        lead: { accountId: "5b10ac8d82e05b22cc7d4ef5", displayName: "Alice" },
        description: "Clinical workflow",
      },
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "projects.get",
      { projectKey: "proj" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/rest/api/3/project/PROJ");
    expect(answer).toMatchObject({
      key: "PROJ",
      name: "Medical",
      isPrivate: true,
      url: "https://company.atlassian.net/browse/PROJ",
      description: "Clinical workflow",
    });
  });

  it("lists the fields of the site as the account may see them", async () => {
    const { fetcher, calls } = stub(() => ({
      json: [
        {
          id: "summary",
          name: "Summary",
          custom: false,
          schema: { type: "string" },
          clauseNames: ["summary"],
          navigable: true,
          searchable: true,
          orderable: true,
        },
        {
          id: "customfield_10010",
          name: "Notes",
          custom: true,
          schema: { type: "array", items: "doc" },
          clauseNames: ["Notes", "cf[10010]"],
        },
      ],
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "fields.list",
      {},
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/rest/api/3/field");
    expect(answer["returned"]).toBe(2);
    expect((answer["items"] as unknown[])[1]).toEqual({
      id: "customfield_10010",
      name: "Notes",
      custom: true,
      type: "array",
      items: "doc",
      clauseNames: ["Notes", "cf[10010]"],
    });
  });

  it("names the issue a transitions answer belongs to and never transitions it", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        expand: "transitions",
        transitions: [
          {
            id: "31",
            name: "Done",
            to: { id: "10001", name: "Done" },
            hasScreen: true,
            isAvailable: true,
            isGlobal: false,
            isInitial: false,
            isConditional: false,
            fields: {
              resolution: { required: true, name: "Resolution" },
              summary: { required: false, name: "Summary" },
            },
          },
        ],
      },
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.transitions",
      { issueKey: "PROJ-123" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe(
      "/rest/api/3/issue/PROJ-123/transitions",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(answer["key"]).toBe("PROJ-123");
    expect((answer["items"] as unknown[])[0]).toMatchObject({
      id: "31",
      name: "Done",
      to: { id: "10001", name: "Done" },
      requiredFields: ["Resolution"],
    });
  });

  it("lists attachments from the issue itself", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        key: "PROJ-123",
        fields: {
          attachment: [
            {
              id: "20001",
              filename: "trace.txt",
              mimeType: "text/plain",
              size: 10,
            },
          ],
        },
      },
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.attachments",
      { issueKey: "PROJ-123" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.searchParams.get("fields")).toBe("attachment");
    expect(answer["key"]).toBe("PROJ-123");
    expect(answer["returned"]).toBe(1);
  });
});
