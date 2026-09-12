/**
 * Hand-written face of the generated Remote contract.
 *
 * The generated `lib/typert.remote-client.d.ts` only exists after a build, and
 * typecheck runs before it, so the client declares the same surface here. The
 * runtime value still comes from the generated artifact through the `/remote`
 * subpath, which tsdown inlines into this bundle.
 */
import type { ClientRemote } from "@deepseek-ai/dsh-api-gateway/client";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type {
  AuditListResult,
  CatalogResult,
  DomainDeleteResult,
  DomainDefinition,
  DomainGetResult,
  DomainListResult,
  DomainWriteResult,
  DraftInspectionResult,
  ExpertRunResult,
  MemoryClearResult,
  MemoryInspectResult,
  ResolvedScopeResult,
} from "../types.js";

export interface DomainExpertsRemote {
  listDomains(): Promise<RemoteResult<DomainListResult>>;
  getDomain(domainId: string): Promise<RemoteResult<DomainGetResult>>;
  draftDomain(domainId: string): Promise<RemoteResult<DomainWriteResult>>;
  inspectDraft(definition: DomainDefinition): Promise<RemoteResult<DraftInspectionResult>>;
  createDomain(definition: DomainDefinition): Promise<RemoteResult<DomainWriteResult>>;
  updateDomain(definition: DomainDefinition): Promise<RemoteResult<DomainWriteResult>>;
  setDomainEnabled(
    domainId: string,
    enabled: boolean,
  ): Promise<RemoteResult<DomainWriteResult>>;
  deleteDomain(domainId: string): Promise<RemoteResult<DomainDeleteResult>>;
  resolveScope(domainId: string): Promise<RemoteResult<ResolvedScopeResult>>;
  catalog(): Promise<RemoteResult<CatalogResult>>;
  inspectMemory(
    domainId: string,
    namespace: string,
    limit: number,
  ): Promise<RemoteResult<MemoryInspectResult>>;
  clearMemory(domainId: string, namespace: string): Promise<RemoteResult<MemoryClearResult>>;
  testExpert(
    domainId: string,
    task: string,
    parentSessionId: string,
  ): Promise<RemoteResult<ExpertRunResult>>;
  recentAudits(limit: number): Promise<RemoteResult<AuditListResult>>;
}

/** The assembled Client Remote plus this plugin's own namespace. */
export type DomainExpertsClientRemote = ClientRemote & {
  readonly domainExperts: DomainExpertsRemote;
};

/** Business envelope carried inside the carrier result. */
export interface Envelope {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
}

export type ApiOutcome<T> = { readonly ok: true; readonly data: T } | {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
};

/**
 * Collapse the two result layers into one outcome.
 *
 * The carrier never rejects for a transport problem, and this plugin never
 * throws for a domain refusal, so both are folded into `{ok:false}` with the
 * most specific code available. The UI shows the code, not a stack trace.
 */
export function toOutcome<T extends Envelope>(result: RemoteResult<T>): ApiOutcome<T> {
  if (!result.ok) {
    const carrier = result.error as { code?: string; message?: string };
    return {
      ok: false,
      code: carrier.code ?? "gateway/error",
      message: carrier.message ?? "The host did not answer this request.",
    };
  }
  if (!result.value.ok) {
    return { ok: false, code: result.value.code, message: result.value.message };
  }
  return { ok: true, data: result.value };
}
