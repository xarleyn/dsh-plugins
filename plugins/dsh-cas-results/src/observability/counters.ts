/**
 * Runtime counters of the plugin (SPEC §28).
 *
 * These are in-memory process counters; disk-level aggregates (object count,
 * logical/stored bytes) are computed by the store on demand and merged into
 * the `dsh_cas_stats` response.
 */

export interface CasCounterSnapshot {
  resultsScanned: number;
  stringsScanned: number;
  objectsStored: number;
  casHits: number;
  logicalBytesSeen: number;
  logicalBytesOffloaded: number;
  physicalBytesWritten: number;
  previewBytes: number;
  retrievalCalls: number;
  searchCalls: number;
  retrievalBytes: number;
  gcObjectsDeleted: number;
  gcBytesFreed: number;
  storageErrors: number;
}

export class CasCounters {
  private readonly values: CasCounterSnapshot = {
    resultsScanned: 0,
    stringsScanned: 0,
    objectsStored: 0,
    casHits: 0,
    logicalBytesSeen: 0,
    logicalBytesOffloaded: 0,
    physicalBytesWritten: 0,
    previewBytes: 0,
    retrievalCalls: 0,
    searchCalls: 0,
    retrievalBytes: 0,
    gcObjectsDeleted: 0,
    gcBytesFreed: 0,
    storageErrors: 0,
  };

  increment<Key extends keyof CasCounterSnapshot>(key: Key, amount: number = 1): void {
    this.values[key] += amount;
  }

  add(partial: Partial<CasCounterSnapshot>): void {
    for (const [key, value] of Object.entries(partial) as [keyof CasCounterSnapshot, number][]) {
      this.values[key] += value;
    }
  }

  snapshot(): CasCounterSnapshot {
    return { ...this.values };
  }
}

/**
 * Derived ratios (SPEC §28). Any of the denominators may be zero early in a
 * session; the ratios are then reported as 0.
 */
export function deriveCasMetrics(snapshot: CasCounterSnapshot, store: { objects: number; logicalBytes: number; storedBytes: number }): {
  dedupRatio: number;
  contextReduction: number;
  storeCompressionRatio: number;
} {
  const dedupRatio = snapshot.physicalBytesWritten > 0
    ? snapshot.logicalBytesOffloaded / snapshot.physicalBytesWritten
    : 0;
  const contextReduction = snapshot.logicalBytesOffloaded > 0
    ? 1 - snapshot.previewBytes / snapshot.logicalBytesOffloaded
    : 0;
  const storeCompressionRatio = store.logicalBytes > 0
    ? store.storedBytes / store.logicalBytes
    : 0;
  return { dedupRatio, contextReduction, storeCompressionRatio };
}
