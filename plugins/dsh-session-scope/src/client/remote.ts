// dsh-session-scope — client-side Remote contract.
//
// The editor reads one directory level at a time through the plugin's own
// `sessionScope/list` RPC instead of a durable slash command: a refresh of
// read-only UI must never enter the session's command history. The descriptors
// below are the client half of that namespace and are validated on `$mount`,
// so the codecs are spelled out rather than inferred.
const stringSchema = {
  parse: function (value: any) {
    if (typeof value !== "string" || value.length === 0)
      throw new TypeError("expected a non-empty string");
    return value;
  },
};
const directoryListingSchema = {
  parse: function (value: any) {
    if (value === null || typeof value !== "object")
      throw new TypeError("expected a directory listing");
    if (typeof value.path !== "string" || typeof value.home !== "string")
      throw new TypeError("invalid directory listing roots");
    if (!Array.isArray(value.crumbs) || !Array.isArray(value.entries))
      throw new TypeError("invalid directory listing rows");
    return {
      path: value.path,
      home: value.home,
      crumbs: value.crumbs.map(function (crumb: any) {
        if (
          crumb === null ||
          typeof crumb !== "object" ||
          typeof crumb.name !== "string" ||
          typeof crumb.path !== "string"
        ) {
          throw new TypeError("invalid directory crumb");
        }
        return { name: crumb.name, path: crumb.path };
      }),
      entries: value.entries.map(function (entry: any) {
        if (
          entry === null ||
          typeof entry !== "object" ||
          typeof entry.name !== "string" ||
          typeof entry.path !== "string"
        ) {
          throw new TypeError("invalid directory entry");
        }
        return {
          name: entry.name,
          path: entry.path,
          hidden: entry.hidden === true,
        };
      }),
      truncated: value.truncated === true,
    };
  },
};
export const scopeRemoteContribution = {
  package: "@yadsh/dsh-session-scope",
  descriptors: [
    {
      id: "@yadsh/dsh-session-scope#sessionScope/list",
      service: "sessionScopeRead",
      namespace: "sessionScope",
      method: "list",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "sessionId",
          wire: "sessionId",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "SessionId",
            schema: stringSchema,
          },
        },
        {
          name: "path",
          wire: "path",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "string",
            schema: stringSchema,
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "DirectoryListing",
        schema: directoryListingSchema,
      },
    },
  ],
};
