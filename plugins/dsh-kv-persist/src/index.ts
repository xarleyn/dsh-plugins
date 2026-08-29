/**
 * dsh-kv-persist — persistent KV-cache/session-state manager (SPEC §1).
 *
 * The Cordis entrypoint: registers `ctx.kvPersist`, the `llm/stream`
 * coordination wrapper, and the session lifecycle listeners. All logic
 * lives in the domain modules (SPEC §10).
 */

import { KvPersistService } from "./service.js";

export { KvPersistService } from "./service.js";
export type {
  KvPersistStatus,
  SessionKvState,
  KvPersistDoctorReport,
  KvPersistServiceDeps,
} from "./service.js";
export { resolveKvPersistConfig, isManagedProvider, KvPersistConfigSchema } from "./config.js";
export type { KvPersistConfig, ResolvedKvPersistConfig } from "./config.js";
export {
  KvPersistError,
  KvBackendUnavailableError,
  KvBackendUnsupportedError,
  KvSaveFailedError,
  KvRestoreFailedError,
  KvEraseFailedError,
} from "./errors.js";
export type { KvPersistErrorCode, SnapshotInvalidationReason } from "./errors.js";
export type { KvPersistenceBackend, BackendCapabilities } from "./backends/types.js";
export { LlamaCppBackend } from "./backends/llama-cpp/backend.js";
export { SingleSlotCoordinator } from "./coordinator/coordinator.js";
export { SnapshotRepository } from "./snapshots/repository.js";
export { snapshotFilename } from "./snapshots/naming.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    kvPersist: KvPersistService;
  }
}

export default KvPersistService;
