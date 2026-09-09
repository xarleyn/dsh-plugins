/**
 * `dsh_cas_info` — metadata of one stored object (SPEC §20, §15).
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { CasStore } from "../cas/types.js";
import { missingObjectMessage, readRefArg } from "./refs.js";

export interface InfoDeps {
  readonly store: CasStore;
}

export function createInfoTool(deps: InfoDeps) {
  const { store } = deps;
  return defineTool({
    name: "dsh_cas_info",
    description: "Report stored metadata (size, type, timestamps, reuse count) for an offloaded tool result.",
    parameters: {
      ref: {
        type: "string",
        required: true,
        description: 'Content reference from the offload marker, e.g. "sha256:ab12...".',
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exists: { type: "boolean", required: true },
          ref: { type: "string", required: true },
          message: { type: "string", required: true },
          size: { type: "integer", required: true },
          storedSize: { type: "integer", required: true },
          kind: { type: "string", required: true },
          mediaType: { type: "string", required: true },
          storageCodec: { type: "string", required: true },
          createdAt: { type: "string", required: true },
          lastAccessedAt: { type: "string", required: true },
          hits: { type: "integer", required: true },
          firstTool: { type: "string", required: true },
        },
      },
      render: (_args, value) => [
        { type: "text", text: value.message },
      ],
    },
    async execute(args: unknown) {
      const hash = readRefArg(args);
      const ref = `sha256:${hash}`;
      const metadata = await store.stat(hash);
      if (metadata === null) {
        return {
          exists: false,
          ref,
          message: missingObjectMessage(ref),
          size: 0,
          storedSize: 0,
          kind: "missing",
          mediaType: "",
          storageCodec: "",
          createdAt: "",
          lastAccessedAt: "",
          hits: 0,
          firstTool: "",
        };
      }
      return {
        exists: true,
        ref,
        message: [
          `CAS object ${ref}`,
          `type: ${metadata.kind} (${metadata.mediaType})`,
          `size: ${metadata.size} bytes (stored as ${metadata.storedSize} bytes, codec: ${metadata.storageCodec})`,
          `created: ${metadata.createdAt}`,
          `last accessed: ${metadata.lastAccessedAt}`,
          `reuse count (hits): ${metadata.hits}`,
          metadata.firstTool === null ? "first tool: unknown" : `first tool: ${metadata.firstTool}`,
        ].join("\n"),
        size: metadata.size,
        storedSize: metadata.storedSize,
        kind: metadata.kind,
        mediaType: metadata.mediaType,
        storageCodec: metadata.storageCodec,
        createdAt: metadata.createdAt,
        lastAccessedAt: metadata.lastAccessedAt,
        hits: metadata.hits,
        firstTool: metadata.firstTool ?? "",
      };
    },
  });
}
