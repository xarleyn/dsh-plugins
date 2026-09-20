/**
 * Archive entry point. The pipeline talks to {@link OriginalResultArchive}
 * only, so a future backend (a DSH plugin-data service, an object store) can
 * replace the local filesystem store without touching the shaper.
 */

export { collectArchive, type GcReport } from "./gc.js";
export { contentRef, isArchiveRef, refHex, stableStringify } from "./hash.js";
export {
  ARCHIVE_HOME_SEGMENTS,
  LocalResultArchive,
  MAX_ARCHIVE_ENTRY_BYTES,
  resolveArchiveRoot,
} from "./local.js";
export {
  shortRef,
  type ArchiveRef,
  type ArchivedToolResult,
  type OriginalResultArchive,
} from "./types.js";
