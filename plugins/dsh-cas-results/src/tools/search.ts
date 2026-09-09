/**
 * `dsh_cas_search` — substring search inside one stored object (SPEC §20).
 *
 * This avoids re-injecting a huge log just to locate one error: matches are
 * returned as bounded line entries with context, capped by count and output
 * size (SPEC §25).
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import { CasError } from "../cas/errors.js";
import type { CasStore } from "../cas/types.js";
import { CasCounters } from "../observability/counters.js";
import { missingObjectMessage, readOptionalBoolean, readOptionalInteger, readRefArg } from "./refs.js";

export interface SearchDeps {
  readonly store: CasStore;
  readonly counters: CasCounters;
}

export function createSearchTool(deps: SearchDeps) {
  const { store, counters } = deps;
  return defineTool({
    name: "dsh_cas_search",
    description: [
      "Search inside a tool result previously offloaded by dsh-cas-results.",
      "Returns matching lines with context without loading the whole payload into the conversation.",
      "Plain substring search; matching is case-insensitive unless caseSensitive is true.",
    ].join(" "),
    parameters: {
      ref: {
        type: "string",
        required: true,
        description: 'Content reference from the offload marker, e.g. "sha256:ab12...".',
      },
      query: { type: "string", required: true, description: "Plain substring to search for." },
      maxMatches: { type: "integer", description: "Maximum number of matches to return. Default: 20." },
      contextLines: { type: "integer", description: "Context lines before and after each match. Default: 3." },
      caseSensitive: { type: "boolean", description: "Match case exactly. Default: false." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref: { type: "string", required: true },
          query: { type: "string", required: true },
          totalMatches: { type: "integer", required: true },
          returnedMatches: { type: "integer", required: true },
          truncated: { type: "boolean", required: true },
          matches: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                line: { type: "integer", required: true },
                text: { type: "string", required: true },
                before: { type: "array", required: true, items: { type: "string" } },
                after: { type: "array", required: true, items: { type: "string" } },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.totalMatches === 0) {
          return [{ type: "text", text: `No matches for ${JSON.stringify(value.query)} in ${value.ref}.` }];
        }
        const blocks = value.matches.map((match) => {
          const lines = [
            ...match.before.map((line) => `      ${line}`),
            `${String(match.line).padStart(6)} | ${match.text}`,
            ...match.after.map((line) => `      ${line}`),
          ];
          return lines.join("\n");
        });
        const suffix = value.truncated
          ? `\n\nShowing ${value.returnedMatches} of ${value.totalMatches} matches; raise maxMatches to see more.`
          : "";
        return [{ type: "text", text: `Found ${value.totalMatches} match(es) for ${JSON.stringify(value.query)}:\n\n${blocks.join("\n---\n")}${suffix}` }];
      },
    },
    async execute(args: unknown) {
      const query = args as Record<string, unknown>;
      const hash = readRefArg(query);
      const needle = query.query;
      if (typeof needle !== "string" || needle.length === 0) {
        throw new CasError("CAS_INVALID_ARGUMENT", 'argument "query" must be a non-empty string');
      }
      const outcome = await store.search(hash, {
        query: needle,
        maxMatches: readOptionalInteger(query, "maxMatches"),
        contextLines: readOptionalInteger(query, "contextLines"),
        caseSensitive: readOptionalBoolean(query, "caseSensitive"),
      }).catch((error: unknown) => {
        if (error instanceof CasError && error.code === "CAS_OBJECT_MISSING") {
          throw new CasError("CAS_OBJECT_MISSING", missingObjectMessage(`sha256:${hash}`));
        }
        throw error;
      });
      counters.increment("searchCalls");
      return {
        ref: outcome.ref,
        query: needle,
        totalMatches: outcome.totalMatches,
        returnedMatches: outcome.returnedMatches,
        truncated: outcome.truncated,
        matches: outcome.matches.map((match) => ({
          line: match.line,
          text: match.text,
          before: [...match.before],
          after: [...match.after],
        })),
      };
    },
  });
}
