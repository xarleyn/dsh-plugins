/**
 * What a conversion hands to the cache.
 *
 * The conversions read the input file themselves, so the content hash and the
 * file's name are already known when the cache is consulted. Passing exactly
 * those two facts down keeps the cache from re-reading a file the orchestrator
 * just read, and keeps the key's inputs visibly identical in every route.
 */

export interface CacheSpec {
  /** SHA-256 of the input bytes as read by the orchestrator. */
  readonly inputSha256: string;
  /** Bare input file name; part of the key, never a path. */
  readonly inputFilename: string;
}
