/**
 * `dsh_cas_gc` — model-callable garbage collection (SPEC §20, §24).
 *
 * Opt-in: the tool is only registered when the configuration explicitly
 * enables `exposeGcTool`. Ordinary agents should not delete retrieval data
 * as a side effect; the service method remains available to host-side code.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { CasStore } from "../cas/types.js";
import type { ResolvedCasResultsConfig } from "../config.js";

export interface GcDeps {
  readonly store: CasStore;
  readonly readConfig: () => ResolvedCasResultsConfig;
}

export function createGcTool(deps: GcDeps) {
  const { store, readConfig } = deps;
  return defineTool({
    name: "dsh_cas_gc",
    description: [
      "Run garbage collection over the dsh-cas-results store.",
      "Deletes objects that expired by TTL or that exceed the configured storage quota.",
      "Retrieve any content you still need before calling this.",
    ].join(" "),
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scannedObjects: { type: "integer", required: true },
          deletedObjects: { type: "integer", required: true },
          freedBytes: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: `dsh-cas-results GC: scanned ${value.scannedObjects} object(s), deleted ${value.deletedObjects}, freed ${value.freedBytes} bytes.`,
        },
      ],
    },
    async execute() {
      const config = readConfig();
      const outcome = await store.gc({
        ttlMs: config.gc.ttlMs,
        minAgeMs: config.gc.minAgeMs,
        maxBytes: config.storage.maxBytes,
      });
      return {
        scannedObjects: outcome.scannedObjects,
        deletedObjects: outcome.deletedObjects,
        freedBytes: outcome.freedBytes,
      };
    },
  });
}
