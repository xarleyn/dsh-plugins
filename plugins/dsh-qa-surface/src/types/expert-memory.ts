/**
 * One memory namespace as the console lists it: which expert it belongs to and
 * whether it takes writes. `access` comes from the expert's own definition, so
 * a shared carrier shows up as what its owner declared rather than as whatever
 * the browser guessed.
 */
export interface QaExpertMemoryScope {
  readonly domainId: string;
  readonly domainName: string;
  readonly namespace: string;
  readonly access: "read-write" | "read-only";
  readonly records: number;
}

/** One line an expert recorded. */
export interface QaExpertMemoryRecord {
  readonly namespace: string;
  readonly key: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One page of a namespace, with the count the filter matched. */
export interface QaExpertMemoryPage {
  readonly records: readonly QaExpertMemoryRecord[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

/** What an operator says a record should hold. The key never moves. */
export interface QaExpertMemoryDraft {
  readonly text: string;
  readonly tags: readonly string[];
}
