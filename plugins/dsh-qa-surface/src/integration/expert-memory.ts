import type { QaExpertMemoryRecord, QaExpertMemoryScope } from "../types.js";

/**
 * The slice of `@yadsh/dsh-domain-experts` the QA console uses.
 *
 * Declared structurally instead of imported, for the same reason the audit
 * remote is: the QA surface has to load on a stand where the experts plugin is
 * not composed at all, and a package dependency would turn "not installed" into
 * "does not boot".
 *
 * What is reached is the plugin's `memoryAdmin` seam — not its `@Remote`
 * methods. A domain-experts remote takes no token and checks no permission,
 * because inside the Harness its caller is already a trusted component; the QA
 * console answers a browser on a LAN port, so it carries the identity itself
 * and goes through the host-plane seam instead.
 */
export interface QaExpertMemoryAdmin {
  scopes(): Promise<readonly QaExpertMemoryScope[]>;
  search(
    namespace: string,
    query: string,
    limit: number,
    offset: number,
  ): Promise<{
    readonly records: readonly QaExpertMemoryRecord[];
    readonly total: number;
  }>;
  correct(input: QaExpertMemoryRecordInput): Promise<QaExpertMemoryRecord>;
  remove(namespace: string, key: string): Promise<boolean>;
  removeMany(namespace: string, keys: readonly string[]): Promise<number>;
  wipe(namespace: string): Promise<number>;
}

/** What a correction says one record should hold. The key is the address. */
export interface QaExpertMemoryRecordInput {
  readonly namespace: string;
  readonly key: string;
  readonly text: string;
  readonly tags?: readonly string[];
}

/** The part of the domain-experts service the console addresses. */
export interface QaDomainExpertsFace {
  readonly memoryAdmin: QaExpertMemoryAdmin;
}

/**
 * Why a memory call failed, in the coarse vocabulary the console's copy table
 * speaks.
 *
 * The refusal is read off the plugin's stable `code` field rather than its
 * message: a message is written for a log and gets reworded, and matching one
 * here would mean a rename in another package silently turns a refusal into an
 * unhandled fault. `cause` is checked too, because the storage seam wraps what
 * the backend threw.
 */
export function expertMemoryReasonOf(
  error: unknown,
):
  | "forbidden"
  | "memory-record-unknown"
  | "memory-unavailable"
  | "invalid-memory"
  | undefined {
  const code = errorCodeOf(error);
  if (code === undefined) return undefined;
  switch (code) {
    case "MEMORY_SCOPE_DENIED":
      return "forbidden";
    case "MEMORY_RECORD_MISSING":
      return "memory-record-unknown";
    case "STORAGE_UNAVAILABLE":
    case "MEMORY_PROVIDER_MISSING":
      return "memory-unavailable";
    case "TASK_REJECTED":
      return "invalid-memory";
    default:
      return undefined;
  }
}

function errorCodeOf(error: unknown): string | undefined {
  for (
    let current: unknown = error;
    current !== undefined && current !== null;
    current = current instanceof Error ? current.cause : undefined
  ) {
    const code = (current as { readonly code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
    if (!(current instanceof Error)) return undefined;
  }
  return undefined;
}
