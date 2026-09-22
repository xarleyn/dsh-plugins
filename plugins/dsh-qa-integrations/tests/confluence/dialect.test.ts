import {
  CONFLUENCE_COMPANION_PATHS,
  CONFLUENCE_OPERATIONS,
  CONFLUENCE_SERVER_COMPANION_PATHS,
  confluenceOperationPath,
} from "../../src/providers/confluence/catalog.js";
import {
  CONFLUENCE_DIALECTS,
  authorizationFor,
} from "../../src/providers/confluence/dialect.js";
import { PAT, TOKEN, EMAIL } from "./shared.js";

/** Endpoints neither product may ever be asked for by this provider. */
const FORBIDDEN =
  /\/admin|properties|operations|likes|watchers|permissions|restrictions|blueprint|template|raw/u;

describe("Confluence deployment dialects", () => {
  it("declares both products' endpoints for every operation", () => {
    for (const [operation, definition] of Object.entries(
      CONFLUENCE_OPERATIONS,
    )) {
      expect(definition.path.startsWith("/wiki/"), operation).toBe(true);
      expect(definition.serverPath.startsWith("/rest/api/"), operation).toBe(
        true,
      );
      expect(FORBIDDEN.test(definition.path), operation).toBe(false);
      expect(FORBIDDEN.test(definition.serverPath), operation).toBe(false);
      expect(confluenceOperationPath(operation, "cloud"), operation).toBe(
        definition.path,
      );
      expect(confluenceOperationPath(operation, "server"), operation).toBe(
        definition.serverPath,
      );
    }
    expect(confluenceOperationPath("nope", "cloud")).toBeUndefined();
  });

  it("answers every read under the product's own root", () => {
    for (const dialect of [
      CONFLUENCE_DIALECTS.cloud,
      CONFLUENCE_DIALECTS.server,
    ]) {
      const root = dialect.deployment === "server" ? "/rest/api/" : "/wiki/";
      const reads = [
        dialect.currentUserPath,
        dialect.pageSpacePath("123").path,
        dialect.pagePath("123").path,
        dialect.commentPath({
          pageId: "123",
          kind: "footer",
          cursor: undefined,
          limit: 20,
        }).path,
        dialect.commentPath({
          pageId: "123",
          kind: "inline",
          cursor: undefined,
          limit: 20,
        }).path,
        dialect.commentChildrenPath({
          commentId: "9",
          kind: "footer",
          cursor: undefined,
          limit: 20,
        }).path,
        dialect.attachmentPath({
          pageId: "123",
          cursor: undefined,
          limit: 20,
        }).path,
        dialect.versionPath({
          pageId: "123",
          cursor: undefined,
          limit: 20,
        }).path,
        dialect.searchPath({
          cql: "space = DEMO",
          start: 0,
          limit: 20,
          includeArchived: undefined,
        }).path,
        dialect.spacePath("DEMO").path,
        dialect.spaceList({
          keys: [],
          type: undefined,
          cursor: undefined,
          limit: 20,
        }).path,
      ];
      for (const path of reads) {
        expect(path.startsWith(root), path).toBe(true);
        expect(FORBIDDEN.test(path), path).toBe(false);
      }
      // No placeholder may reach a request path: every one is filled from a
      // value the provider checked first.
      expect(reads.some((path) => path.includes(":"))).toBe(false);
    }
  });

  it("pages a Cloud listing by cursor and a self-hosted one by offset", () => {
    const cloud = CONFLUENCE_DIALECTS.cloud.spaceList({
      keys: [],
      type: undefined,
      cursor: "eyJvZmZzZXQiOjI1fQ==",
      limit: 20,
    });
    expect(cloud.query["cursor"]).toBe("eyJvZmZzZXQiOjI1fQ==");
    expect(cloud.query["start"]).toBeUndefined();

    const server = CONFLUENCE_DIALECTS.server.spaceList({
      keys: [],
      type: undefined,
      cursor: "25",
      limit: 20,
    });
    expect(server.query["start"]).toBe(25);
    expect(server.query["cursor"]).toBeUndefined();
  });

  it("keeps the comment children of one kind to their own collection", () => {
    const footer = CONFLUENCE_COMPANION_PATHS[0] ?? "";
    const inline = CONFLUENCE_COMPANION_PATHS[1] ?? "";
    expect(
      CONFLUENCE_DIALECTS.cloud.commentChildrenPath({
        commentId: "9",
        kind: "footer",
        cursor: undefined,
        limit: 20,
      }).path,
    ).toBe(footer.replace(":commentId", "9"));
    expect(
      CONFLUENCE_DIALECTS.cloud.commentChildrenPath({
        commentId: "9",
        kind: "inline",
        cursor: undefined,
        limit: 20,
      }).path,
    ).toBe(inline.replace(":commentId", "9"));
    // A self-hosted installation has one collection for both kinds, so the
    // product's own endpoint is used and the kind never shapes the path.
    const endpoint = (CONFLUENCE_SERVER_COMPANION_PATHS[0] ?? "").replace(
      ":commentId",
      "9",
    );
    for (const kind of ["footer", "inline"] as const) {
      expect(
        CONFLUENCE_DIALECTS.server.commentChildrenPath({
          commentId: "9",
          kind,
          cursor: undefined,
          limit: 20,
        }).path,
      ).toBe(endpoint);
    }
  });

  it("spends each product's credential by the scheme that product accepts", () => {
    expect(
      authorizationFor(CONFLUENCE_DIALECTS.server, { email: "", token: PAT }),
    ).toBe(`Bearer ${PAT}`);
    const basic = authorizationFor(CONFLUENCE_DIALECTS.cloud, {
      email: EMAIL,
      token: TOKEN,
    });
    expect(basic).toBe(
      `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`, "utf8").toString("base64")}`,
    );
    // A Cloud connection without an account cannot be authenticated at all, and
    // a bearer token must never be offered to a product that wants a pair.
    expect(() =>
      authorizationFor(CONFLUENCE_DIALECTS.cloud, { email: "", token: TOKEN }),
    ).toThrow(/e-mail/u);
  });
});
