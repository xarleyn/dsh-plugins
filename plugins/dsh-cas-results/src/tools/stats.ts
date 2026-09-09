/**
 * `dsh_cas_stats` — aggregate storage statistics and runtime counters
 * (SPEC §20, §28).
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import type { CasStore } from "../cas/types.js";
import { CasCounters, deriveCasMetrics } from "../observability/counters.js";
import { formatBytes } from "../transform/marker.js";

export interface StatsDeps {
  readonly store: CasStore;
  readonly counters: CasCounters;
}

export function createStatsTool(deps: StatsDeps) {
  const { store, counters } = deps;
  return defineTool({
    name: "dsh_cas_stats",
    description: "Report dsh-cas-results storage statistics: object counts, byte totals, dedup and context reduction.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          objects: { type: "integer", required: true },
          logicalBytes: { type: "integer", required: true },
          storedBytes: { type: "integer", required: true },
          largestObjectBytes: { type: "integer", required: true },
          objectsStored: { type: "integer", required: true },
          casHits: { type: "integer", required: true },
          deduplicatedWrites: { type: "integer", required: true },
          logicalBytesOffloaded: { type: "integer", required: true },
          physicalBytesWritten: { type: "integer", required: true },
          previewBytes: { type: "integer", required: true },
          retrievalCalls: { type: "integer", required: true },
          searchCalls: { type: "integer", required: true },
          retrievalBytes: { type: "integer", required: true },
          gcObjectsDeleted: { type: "integer", required: true },
          gcBytesFreed: { type: "integer", required: true },
          storageErrors: { type: "integer", required: true },
          dedupRatio: { type: "number", required: true },
          contextReduction: { type: "number", required: true },
          storeCompressionRatio: { type: "number", required: true },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: [
            `objects: ${value.objects}`,
            `logical bytes: ${formatBytes(value.logicalBytes)}`,
            `stored bytes: ${formatBytes(value.storedBytes)}`,
            `deduplicated writes: ${value.deduplicatedWrites}`,
            `logical offloaded: ${formatBytes(value.logicalBytesOffloaded)}`,
            `model-visible previews: ${formatBytes(value.previewBytes)}`,
            `context reduction: ${(value.contextReduction * 100).toFixed(1)}%`,
            `largest object: ${formatBytes(value.largestObjectBytes)}`,
            `storage errors: ${value.storageErrors}`,
          ].join("\n"),
        },
      ],
    },
    async execute() {
      const disk = await store.stats();
      const runtime = counters.snapshot();
      const derived = deriveCasMetrics(runtime, disk);
      return {
        objects: disk.objects,
        logicalBytes: disk.logicalBytes,
        storedBytes: disk.storedBytes,
        largestObjectBytes: disk.largestObjectBytes,
        objectsStored: runtime.objectsStored,
        casHits: runtime.casHits,
        deduplicatedWrites: disk.hits,
        logicalBytesOffloaded: runtime.logicalBytesOffloaded,
        physicalBytesWritten: runtime.physicalBytesWritten,
        previewBytes: runtime.previewBytes,
        retrievalCalls: runtime.retrievalCalls,
        searchCalls: runtime.searchCalls,
        retrievalBytes: runtime.retrievalBytes,
        gcObjectsDeleted: runtime.gcObjectsDeleted,
        gcBytesFreed: runtime.gcBytesFreed,
        storageErrors: runtime.storageErrors,
        dedupRatio: derived.dedupRatio,
        contextReduction: derived.contextReduction,
        storeCompressionRatio: derived.storeCompressionRatio,
      };
    },
  });
}
