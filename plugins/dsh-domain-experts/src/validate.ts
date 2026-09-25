/**
 * Validation of a catalog entry, and the answer it takes.
 *
 * The counterpart of `catalog.ts`: the catalog reports what exists, this decides
 * whether a definition of it is acceptable. A draft gets the defaults the
 * operator configured before it can be judged, an inspection is reported as the
 * field-level issues the editor highlights, and a memory request is held to the
 * namespaces its domain actually owns.
 *
 * Every answer then leaves through one envelope: the three fields the client
 * reads, then the payload — the accepted one, or the code of the refusal with
 * the empty payload its own type asks for. That is why a Remote method can be
 * one line and why no rejection ever reaches the browser as a throw.
 */
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { memoryProjection } from "./catalog.js";
import type { ResolvedConfig } from "./config.js";
import {
  DomainExpertsError,
  errorCodeOf,
  errorMessageOf,
} from "./host/errors.js";
import type { DomainMemoryProvider } from "./host/memory/registry.js";
import type { DomainRegistry } from "./host/registry.js";
import { memoryEntries, type MemoryOwner } from "./host/resolver.js";
import type {
  DomainDefinition,
  DomainDeleteResult,
  DomainGetResult,
  DomainListResult,
  DomainWriteResult,
  DraftInspectionResult,
  ExpertRunResult,
  MemoryClearResult,
  MemoryInspectResult,
  ResolvedMemoryEntry,
  ResolvedScopeResult,
  ValidationIssueView,
} from "./types.js";
import { emptyDomainDraft } from "./types.js";

/** The verdict of one inspection, as `DomainRegistry` reports it. */
type Inspection = ReturnType<DomainRegistry["inspectDraft"]>;

/** The fields every answer carries, before its payload. */
interface Envelope {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
}

/** The answer of a call that got through. */
export function accepted<P extends object>(payload: P): Envelope & P {
  return { ok: true, code: "", message: "", ...payload };
}

/** The answer of a call that was refused, carrying the code of the cause. */
function refused<P extends object>(error: unknown, payload: P): Envelope & P {
  return {
    ok: false,
    code: errorCodeOf(error),
    message: errorMessageOf(error),
    ...payload,
  };
}

/**
 * Run one Remote call, and answer instead of throwing.
 *
 * The store, the schema and the subagent runtime each refuse in their own way;
 * the client reads one shape. `refuse` names the empty payload this call's
 * result type asks for, so a refusal stays a well-formed answer.
 */
export async function guarded<T extends Envelope>(
  produce: () => Promise<T>,
  refuse: (error: unknown) => T,
): Promise<T> {
  try {
    return await produce();
  } catch (error) {
    return refuse(error);
  }
}

/** A new domain, prefilled with the defaults the operator configured. */
export function domainDraft(
  domainId: string,
  config: ResolvedConfig,
  now: number,
): DomainWriteResult {
  const draft = emptyDomainDraft(domainId, now);
  return accepted({
    domain: {
      ...draft,
      memory: { ...draft.memory, namespace: `domain/${domainId}` },
      delegation: {
        ...draft.delegation,
        maxDepth: config.defaultMaxDepth,
        crossDomainMode: config.defaultCrossDomainMode,
      },
    },
  });
}

/** A draft judged without being persisted: the definition plus its issues. */
export function draftInspection(inspection: Inspection): DraftInspectionResult {
  return accepted({
    message: inspection.message,
    definition: inspection.definition,
    issues: inspection.issues.map((issue): ValidationIssueView => ({
      severity: issue.severity,
      field: issue.field,
      message: issue.message,
    })),
  });
}

/**
 * The namespaces a memory read may cover.
 *
 * An empty request means every namespace the caller's owner can reach; a named
 * one has to be one of them, because the namespace list is the whole of what
 * separates one expert's memory from another's.
 */
export function memoryTargets(
  definition: DomainDefinition,
  namespace: string,
  owner: MemoryOwner,
): readonly ResolvedMemoryEntry[] {
  const entries = memoryEntries(definition, owner);
  const requested = namespace.trim();
  const targets = entries.filter(
    (entry) => requested === "" || entry.namespace === requested,
  );
  if (requested !== "" && targets.length === 0) {
    throw new DomainExpertsError(
      "MEMORY_SCOPE_DENIED",
      `Namespace "${requested}" does not belong to domain "${definition.id}".`,
      { refs: [requested] },
    );
  }
  return targets;
}

/**
 * The namespace a memory clear may empty.
 *
 * Only the domain's own one: an account's namespace is what a run an account
 * claimed writes, and this page speaks for no account. A shared or foreign
 * namespace is readable by this expert, and reading another domain's memory
 * does not grant the right to erase it. An unnamed request means the own
 * namespace, when the domain has one.
 */
export function clearableNamespace(
  definition: DomainDefinition,
  namespace: string,
  owner: MemoryOwner,
): string {
  const writable = memoryEntries(definition, owner).find(
    (entry) => entry.access === "read-write",
  );
  const trimmed = namespace.trim();
  const requested = trimmed === "" ? (writable?.namespace ?? "") : trimmed;
  if (writable === undefined || requested !== writable.namespace) {
    throw new DomainExpertsError(
      "MEMORY_SCOPE_DENIED",
      `Only the domain's own namespace${
        writable === undefined ? "" : ` "${writable.namespace}"`
      } can be cleared from this page; an account's namespace is not reachable here.`,
      { refs: [requested] },
    );
  }
  return requested;
}

/**
 * The three facts the service supplies before one expert's memory is answered:
 * which domain the call addresses, which provider the deployment selected, and
 * which owner the page speaks for while it has no account to name.
 */
export interface MemoryAccess {
  /** The enabled definition of that domain, or the refusal naming it. */
  domain(domainId: string): Promise<DomainDefinition>;
  /** The provider its memory is read through. */
  provider(): DomainMemoryProvider;
  /** The owner this call stands for: the domain tier, never one account. */
  owner(): MemoryOwner;
}

/**
 * One expert's memory, as the management UI reads it.
 *
 * The request is held to the namespaces the definition owns before a single
 * record is read, so a foreign namespace is refused rather than counted.
 */
export function inspectDomainMemory(
  access: MemoryAccess,
  domainId: string,
  namespace: string,
  limit: number,
): Promise<MemoryInspectResult> {
  return guarded(async () => {
    const targets = memoryTargets(
      await access.domain(domainId),
      namespace,
      access.owner(),
    );
    return accepted(await memoryProjection(access.provider(), targets, limit));
  }, memoryInspectRefusal);
}

/** Empty the private namespace of one expert, and report what left it. */
export function clearDomainMemory(
  access: MemoryAccess,
  domainId: string,
  namespace: string,
  logger: PluginLogger,
): Promise<MemoryClearResult> {
  return guarded(async () => {
    const definition = await access.domain(domainId);
    const requested = clearableNamespace(definition, namespace, access.owner());
    const cleared = await access.provider().clear(requested);
    logger.info("domain-experts/memory-cleared", {
      domain: definition.id,
      namespace: requested,
      cleared,
    });
    return accepted({ cleared });
  }, memoryClearRefusal);
}

/** Why a test run cannot start: an expert child needs a live parent session. */
export function missingTestParent(): DomainExpertsError {
  return new DomainExpertsError(
    "TASK_REJECTED",
    "Running a test needs a live session to act as the caller's parent. Open a chat, or use the domain_expert tool from a conversation.",
  );
}

/** A refused list read: the catalog answers it empty. */
export function domainListRefusal(error: unknown): DomainListResult {
  return refused(error, { domains: [] });
}

/** A refused single read: no definition. */
export function domainGetRefusal(error: unknown): DomainGetResult {
  return refused(error, { domain: null });
}

/** A refused write, including the duplicate and missing-id verdicts of the schema. */
export function domainWriteRefusal(error: unknown): DomainWriteResult {
  return refused(error, { domain: null });
}

/** A refused delete: nothing left the catalog. */
export function domainDeleteRefusal(error: unknown): DomainDeleteResult {
  return refused(error, { deleted: false });
}

/** A refused scope resolution: the inspector shows the refusal instead. */
export function scopeRefusal(error: unknown): ResolvedScopeResult {
  return refused(error, { profile: null });
}

/** A refused draft inspection: no verdict on a definition it could not read. */
export function draftInspectionRefusal(error: unknown): DraftInspectionResult {
  return refused(error, { definition: null, issues: [] });
}

/** A refused memory read: the inspector keeps its shape and says why it is empty. */
export function memoryInspectRefusal(error: unknown): MemoryInspectResult {
  return refused(error, { namespaces: [], records: [] });
}

/** A refused memory clear: nothing was removed. */
export function memoryClearRefusal(error: unknown): MemoryClearResult {
  return refused(error, { cleared: 0 });
}

/** A refused test run: the refusal replaces the result, not the call. */
export function expertRunRefusal(error: unknown): ExpertRunResult {
  return refused(error, { result: null });
}
