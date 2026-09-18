import { resolveConfig } from "../../src/config.js";
import { type ConfluenceFlags } from "../../src/providers/confluence/config.js";
import { ConfluenceProvider } from "../../src/providers/confluence/index.js";

export const TOKEN = "ATATT3xFfGF0abcdefghijklmnop";
export const EMAIL = "alice@example.com";

export const COMPANY = {
  id: "company",
  label: "Company",
  baseUrl: "https://company.atlassian.net",
};
export const SANDBOX = {
  id: "sandbox",
  label: "Sandbox",
  baseUrl: "https://sandbox.atlassian.net",
};
export const SITES = [COMPANY, SANDBOX];

export function config(confluence: Partial<ConfluenceFlags> = {}) {
  return resolveConfig({ confluence: { instances: SITES, ...confluence } });
}

export interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
  readonly headers?: Record<string, string>;
}

export interface StubCall {
  readonly url: URL;
  readonly init: RequestInit;
}

export function stub(handler: (url: URL, init: RequestInit) => StubResult) {
  const calls: StubCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const request = init ?? {};
    calls.push({ url, init: request });
    const result = handler(url, request);
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
export function credentialFor(
  instanceId: string,
  fetcher: typeof fetch,
  email = EMAIL,
) {
  const provider = new ConfluenceProvider(config(), fetcher);
  return provider.parseCredential(TOKEN, { instanceId, email }).credential;
}

/** One provider call, with the connect form's choices already applied. */
export async function call(
  operation: string,
  input: Record<string, unknown>,
  options: {
    readonly confluence?: Partial<ConfluenceFlags>;
    readonly fetcher: typeof fetch;
    readonly instanceId?: string;
    readonly email?: string;
  },
) {
  const provider = new ConfluenceProvider(
    config(options.confluence),
    options.fetcher,
  );
  const credential = provider.parseCredential(TOKEN, {
    instanceId: options.instanceId ?? "company",
    email: options.email ?? EMAIL,
  }).credential;
  return provider.execute(
    { credential, externalUserId: "acc-alice" },
    operation,
    input,
  );
}

export const ADF = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Steps" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Run " },
        { type: "text", text: "npm ci", marks: [{ type: "code" }] },
        { type: "text", text: " then " },
        {
          type: "text",
          text: "roll back",
          marks: [{ type: "link", attrs: { href: "https://example.com/rb" } }],
        },
        { type: "text", text: " — ask " },
        { type: "mention", attrs: { id: "acc-bob", text: "@Bob" } },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "first" }] },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "nested" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "second" }] },
          ],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "bash" },
      content: [{ type: "text", text: "make deploy\n" }],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "env" }] },
              ],
            },
            {
              type: "tableHeader",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "url" }] },
              ],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "prod" }],
                },
              ],
            },
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "https://a|b" }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "panel",
      attrs: { panelType: "warning" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Careful" }] },
      ],
    },
    {
      type: "paragraph",
      content: [{ type: "status", attrs: { text: "DONE", color: "green" } }],
    },
    {
      type: "extension",
      attrs: { extensionKey: "jira", extensionType: "com.atlassian.macro" },
    },
    {
      type: "mediaSingle",
      content: [{ type: "media", attrs: { id: "media-1", alt: "chart" } }],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { state: "DONE" },
          content: [{ type: "text", text: "plan" }],
        },
        {
          type: "taskItem",
          attrs: { state: "TODO" },
          content: [{ type: "text", text: "ship" }],
        },
      ],
    },
  ],
};

export const PAGE = {
  id: "123456",
  status: "current",
  title: "Deployment Guide",
  spaceId: "98305",
  parentId: "111",
  authorId: "acc-alice",
  ownerId: "acc-alice",
  createdAt: "2026-08-01T10:00:00.000Z",
  version: {
    number: 7,
    message: "update steps",
    createdAt: "2026-09-10T09:00:00.000Z",
    authorId: "acc-alice",
    minorEdit: false,
  },
  body: {
    atlas_doc_format: {
      representation: "atlas_doc_format",
      value: JSON.stringify(ADF),
    },
  },
  labels: {
    results: [
      { id: "1", name: "runbook", prefix: "global" },
      { id: "2", name: "release", prefix: "global" },
    ],
  },
  _links: {
    webui: "/spaces/ENG/pages/123456/Deployment+Guide",
    base: "https://company.atlassian.net/wiki",
  },
};

export const SPACE = {
  id: "98305",
  key: "ENG",
  name: "Engineering",
  type: "global",
  status: "current",
  homepageId: "1",
};

/** A site that answers the identity, page and space calls, and nothing else. */
export function siteStub(page = PAGE, space = SPACE) {
  return stub((url) => {
    if (url.pathname.endsWith("/user/current")) {
      return { json: { accountId: "acc-alice", displayName: "Alice Example" } };
    }
    if (url.pathname.includes("/pages/")) return { json: page };
    if (url.pathname.includes("/spaces/")) return { json: space };
    return { status: 404, json: { message: "not found" } };
  });
}

export function bodyOf(value: unknown): Record<string, unknown> {
  const answer = value as Record<string, unknown>;
  return answer["untrustedContent"] as Record<string, unknown>;
}
