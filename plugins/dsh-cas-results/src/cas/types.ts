/**
 * Shared contracts of the content-addressed store (SPEC §9).
 *
 * The DSH integration layer depends on the `CasStore` interface only, so a
 * future backend (S3/MinIO) can replace the filesystem implementation without
 * touching result interception.
 */

/** Logical content classes a CAS object can represent (SPEC §10, §18). */
export type CasKind = "text" | "log" | "html" | "binary";

/** On-disk storage codec; identity is always computed over logical bytes (SPEC §17). */
export type StorageCodec = "none" | "gzip";

export interface CasMetadata {
  readonly version: 1;
  readonly algorithm: "sha256";
  /** 64 lowercase hex characters, no `sha256:` prefix. */
  readonly hash: string;
  /** Logical (uncompressed) payload size in bytes. */
  readonly size: number;
  /** Serialized blob size in bytes. */
  readonly storedSize: number;
  readonly kind: CasKind;
  readonly mediaType: string;
  readonly encoding: "utf8" | "binary";
  readonly storageCodec: StorageCodec;
  readonly createdAt: string;
  readonly lastAccessedAt: string;
  readonly firstTool: string | null;
  /** Advisory reuse counter; not transactional in v1 (SPEC §13). */
  readonly hits: number;
}

export interface CasObject {
  readonly ref: string;
  readonly metadata: CasMetadata;
  /** True when the payload already existed and no new blob was written. */
  readonly reused: boolean;
}

export interface CasPutInput {
  /** Logical (uncompressed) payload bytes; identity is hashed over these. */
  readonly payload: Uint8Array;
  readonly kind: CasKind;
  readonly mediaType: string;
  readonly encoding: "utf8" | "binary";
  readonly firstTool?: string;
}

export interface CasReadOptions {
  offset?: number;
  limit?: number;
  /** Re-hash the decompressed payload and compare with the address. Default: true. */
  verify?: boolean;
}

export interface CasReadResult {
  readonly ref: string;
  readonly kind: CasKind;
  readonly mediaType: string;
  readonly encoding: "utf8" | "binary";
  /** Requested window start (clamped to the payload). */
  readonly offset: number;
  /** Logical payload size in bytes. */
  readonly totalSize: number;
  /** True when bytes beyond `offset + bytes.length` exist. */
  readonly truncated: boolean;
  readonly bytes: Uint8Array;
}

export interface CasSearchMatch {
  readonly line: number;
  readonly text: string;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export interface CasSearchQuery {
  readonly query: string;
  maxMatches?: number;
  contextLines?: number;
  caseSensitive?: boolean;
}

export interface CasSearchResult {
  readonly ref: string;
  readonly totalMatches: number;
  readonly returnedMatches: number;
  /** True when matches were dropped due to output limits. */
  readonly truncated: boolean;
  readonly matches: readonly CasSearchMatch[];
}

export interface CasStoreStats {
  readonly objects: number;
  readonly logicalBytes: number;
  readonly storedBytes: number;
  readonly largestObjectBytes: number;
  readonly hits: number;
}

export interface CasGcOptions {
  /** Delete objects whose last access is older than this (ms). */
  ttlMs: number;
  /** Never delete objects younger than this during routine GC (ms). */
  minAgeMs: number;
  /** Emergency quota over logical bytes; oldest access is evicted first. */
  maxBytes: number;
  now?: number;
}

export interface CasGcResult {
  readonly scannedObjects: number;
  readonly deletedObjects: number;
  readonly freedBytes: number;
}

/** Backend-independent storage surface (SPEC §9). */
export interface CasStore {
  put(input: CasPutInput): Promise<CasObject>;
  has(hash: string): Promise<boolean>;
  stat(hash: string): Promise<CasMetadata | null>;
  read(hash: string, options?: CasReadOptions): Promise<CasReadResult>;
  search(hash: string, query: CasSearchQuery): Promise<CasSearchResult>;
  touch(hash: string, accessedAt?: Date): Promise<void>;
  gc(options: CasGcOptions): Promise<CasGcResult>;
  stats(): Promise<CasStoreStats>;
}
