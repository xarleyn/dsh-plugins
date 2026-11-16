import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";

export const FIND_TOOLS = "qa_find_tools";
const aliases = {
  gitlab: ["гитлаб", "репозитор", "коммит", "мерж", "ветк"],
  teamcity: ["тимсити", "сборк", "билд"],
  testit: ["тест", "прогон", "автотест"],
  weblate: ["веблейт", "перевод", "локализац"],
  bitrix24: ["битрикс", "сделк", "лид", "crm"],
} as const;
type Family = keyof typeof aliases;
export function discoveryFamily(name: string): Family | undefined {
  const prefix = name.split("_", 1)[0]!;
  if (prefix === "bitrix") return "bitrix24";
  return Object.hasOwn(aliases, prefix) ? (prefix as Family) : undefined;
}

interface Entry {
  name: string;
  description: string;
}
interface Query {
  query?: string;
  browse?: boolean;
  offset?: number;
}
const words = (text: string): string[] =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** One bounded page. Browse never reveals tools; exact names do not fall back to fuzzy matches. */
export function searchTools(entries: readonly Entry[], args: Query) {
  const query = (args.query ?? "").trim().toLowerCase();
  const tokens = words(query);
  const exact = query.includes("_");
  const ranked = entries
    .map((entry) => {
      const family = discoveryFamily(entry.name)!;
      const name = words(entry.name);
      const description = words(entry.description);
      const score = exact
        ? Number(query === entry.name)
        : tokens.reduce(
            (sum, token) =>
              sum +
              (name.includes(token) || token === family
                ? 5
                : aliases[family].some((a) => token.startsWith(a))
                  ? 3
                  : description.includes(token)
                    ? 1
                    : 0),
            0,
          );
      return { entry, score };
    })
    .filter((row) => row.score > 0 || (args.browse && !query))
    .sort(
      (a, b) => b.score - a.score || (a.entry.name < b.entry.name ? -1 : 1),
    );
  const offset = args.offset ?? 0;
  const limit = args.browse ? 12 : 5;
  const matches = ranked
    .slice(offset, offset + limit)
    .map(({ entry }) => entry);
  return {
    matches,
    nextOffset: offset + limit < ranked.length ? offset + limit : null,
  };
}

/** Discovery returns names; it never receives arguments for, or executes, any integration. */
export function createFindTools(owner: Agent, search: (args: Query) => string) {
  return defineTool({
    name: FIND_TOOLS,
    description:
      "Find available GitLab, TeamCity, Test IT, Weblate or Bitrix24 tools by topic, family or exact tool name. Matches become native tools on the next step. Browse to list without loading; call again with an exact name to load it.",
    parameters: {
      query: {
        type: "string",
        description:
          "Topic, family, or exact tool name. Omit with browse to list.",
      },
      browse: {
        type: "boolean",
        description: "List a page without opening any tools.",
      },
      offset: {
        type: "integer",
        description:
          "Continue with the nextOffset returned for the same query.",
      },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    execute: async (args, exec) => {
      if (exec.agent !== owner)
        throw new Error("Tool discovery is unavailable.");
      exec.signal.throwIfAborted();
      if (
        (args.query?.length ?? 0) > 250 ||
        (args.offset ?? 0) < 0 ||
        !Number.isSafeInteger(args.offset ?? 0)
      )
        throw new Error(
          "Use at most 250 query characters and a non-negative integer offset.",
        );
      return search(args);
    },
  });
}
