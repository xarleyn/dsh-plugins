import { defineTool } from "@deepseek-ai/dsh-tools";
import type { MemoryRecord } from "../../types.js";
import { DomainExpertsError } from "../errors.js";
import { memoryEntries } from "../resolver.js";
import {
  callerSessionIdOf,
  requireAgent,
  toToolError,
  type ToolDependencies,
} from "./shared.js";

const RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    namespace: {
      type: "string",
      required: true,
      description: "Owning namespace.",
    },
    key: {
      type: "string",
      required: true,
      description: "Record key inside the namespace.",
    },
    text: { type: "string", required: true, description: "Recorded text." },
    tags: {
      type: "array",
      required: true,
      description: "Free-form tags.",
      items: { type: "string" },
    },
    updatedAt: {
      type: "integer",
      required: true,
      description: "Last write, epoch ms.",
    },
  },
} as const;

/**
 * Read and write the calling expert's own memory (design §15).
 *
 * The model never supplies a namespace that is trusted: `namespace` is
 * validated against the namespaces resolved from the persisted definition, and
 * a write is refused anywhere but the private one. This is what makes the
 * memory boundary real rather than a sentence in a prompt.
 */
export function createDomainMemoryTool(dependencies: ToolDependencies) {
  return defineTool({
    name: "domain_memory",
    description:
      "Read or write the memory of the domain expert you are running as. Only the namespaces configured for that expert are reachable, and only its own namespace accepts writes. Use it to record a durable finding or to recall what this domain already knows.",
    parameters: {
      action: {
        type: "string",
        required: true,
        enum: ["read", "write", "forget", "list"],
        description:
          "read searches, write stores, forget deletes one key, list shows namespaces.",
      },
      key: {
        type: "string",
        description: "Record key. Required for write and forget.",
      },
      text: {
        type: "string",
        description: "Text to store on write, or the search query on read.",
      },
      tags: {
        type: "array",
        description: "Tags attached to a written record.",
        items: { type: "string" },
      },
      namespace: {
        type: "string",
        description:
          "Optional namespace to read from; refused when it is not one of yours.",
      },
      limit: {
        type: "integer",
        description: "Maximum records to return on read or list.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            required: true,
            description: "Echo of the requested action.",
          },
          namespaces: {
            type: "array",
            required: true,
            description:
              "Namespaces this expert may use, with their access mode.",
            items: { type: "string" },
          },
          records: {
            type: "array",
            required: true,
            description: "Records returned by the call.",
            items: RECORD_SCHEMA,
          },
          affected: {
            type: "integer",
            required: true,
            description: "Records written or removed.",
          },
          message: {
            type: "string",
            required: true,
            description: "Human-readable outcome.",
          },
        },
      },
      render: (_args, value) => {
        const lines = [value.message];
        if (value.namespaces.length > 0) {
          lines.push(
            "",
            "Namespaces:",
            ...value.namespaces.map((item) => `- ${item}`),
          );
        }
        if (value.records.length > 0) {
          lines.push("", "Records:");
          for (const record of value.records) {
            lines.push(`- [${record.namespace}/${record.key}] ${record.text}`);
          }
        }
        return [{ type: "text", text: lines.join("\n") }];
      },
    },
    async execute(args, exec) {
      const agent = requireAgent(exec.agent, "domain_memory");
      const sessionId = callerSessionIdOf(agent);
      try {
        const active = dependencies.activeRun(sessionId);
        if (active === undefined) {
          throw new DomainExpertsError(
            "EXPERT_NOT_CALLER",
            "domain_memory is only available inside a domain expert. Call domain_expert first, then use its memory from within that run.",
          );
        }
        const definition = await dependencies.requireDefinition(
          active.domainId,
        );
        const entries = memoryEntries(definition);
        const namespaces = entries.map(
          (entry) =>
            `${entry.namespace} (${entry.access === "read-write" ? "read/write" : "read-only"})`,
        );
        const writable =
          entries.find((entry) => entry.access === "read-write")?.namespace ??
          "";
        const readable = entries.map((entry) => entry.namespace);
        const provider = dependencies.memory();
        const limit = clampLimit(args.limit);

        switch (args.action) {
          case "list": {
            const records: MemoryRecord[] = [];
            for (const namespace of readable) {
              records.push(...(await provider.inspect(namespace)));
            }
            const trimmed = records
              .sort((left, right) => right.updatedAt - left.updatedAt)
              .slice(0, limit);
            return {
              action: args.action,
              namespaces,
              records: trimmed.map(toWire),
              affected: 0,
              message: `${String(records.length)} record${records.length === 1 ? "" : "s"} in ${String(readable.length)} namespace${readable.length === 1 ? "" : "s"}.`,
            };
          }
          case "read": {
            const target =
              args.namespace === undefined || args.namespace === ""
                ? readable
                : [requireNamespace(args.namespace, readable)];
            const records = await provider.retrieve({
              namespaces: target,
              query: (args.text ?? "").trim(),
              limit,
            });
            return {
              action: args.action,
              namespaces,
              records: records.map(toWire),
              affected: 0,
              message: `Recalled ${String(records.length)} record${records.length === 1 ? "" : "s"}.`,
            };
          }
          case "write": {
            const key = (args.key ?? "").trim();
            const text = (args.text ?? "").trim();
            if (text === "") {
              throw new DomainExpertsError(
                "TASK_REJECTED",
                "domain_memory write needs non-empty text.",
              );
            }
            if (args.namespace !== undefined && args.namespace !== "") {
              const requested = requireNamespace(args.namespace, readable);
              if (requested !== writable) {
                throw new DomainExpertsError(
                  "MEMORY_SCOPE_DENIED",
                  `Namespace "${requested}" is read-only for this expert; only "${writable}" accepts writes.`,
                  { refs: [requested] },
                );
              }
            }
            const record = await provider.remember(
              writable,
              key === "" ? derivedKey(text) : key,
              text,
              args.tags ?? [],
            );
            return {
              action: args.action,
              namespaces,
              records: [toWire(record)],
              affected: 1,
              message: `Stored under ${record.namespace}/${record.key}.`,
            };
          }
          case "forget": {
            const key = (args.key ?? "").trim();
            if (key === "") {
              throw new DomainExpertsError(
                "TASK_REJECTED",
                "domain_memory forget needs the record key.",
              );
            }
            const removed = await provider.forget(writable, key);
            return {
              action: args.action,
              namespaces,
              records: [],
              affected: removed ? 1 : 0,
              message: removed
                ? `Removed ${writable}/${key}.`
                : `No record ${writable}/${key} exists.`,
            };
          }
        }
      } catch (error) {
        throw toToolError(error);
      }
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Domain memory: ${args.action}`,
    }),
  });
}

function requireNamespace(
  requested: string,
  readable: readonly string[],
): string {
  const normalized = requested.trim().replace(/^\/+|\/+$/gu, "");
  if (!readable.includes(normalized)) {
    throw new DomainExpertsError(
      "MEMORY_SCOPE_DENIED",
      `Namespace "${requested}" is not available to this expert. Available: ${readable.join(", ")}.`,
      { refs: [requested] },
    );
  }
  return normalized;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return 20;
  return Math.min(Math.trunc(limit), 200);
}

function derivedKey(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  const base = slug === "" ? "note" : slug;
  return `${base}-${String(hash(text))}`;
}

/** Stable short digest so a re-recorded identical note updates in place. */
function hash(text: string): number {
  let value = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return Math.abs(value) % 1_000_000;
}

function toWire(record: MemoryRecord): {
  namespace: string;
  key: string;
  text: string;
  tags: string[];
  updatedAt: number;
} {
  return {
    namespace: record.namespace,
    key: record.key,
    text: record.text,
    tags: [...record.tags],
    updatedAt: record.updatedAt,
  };
}
