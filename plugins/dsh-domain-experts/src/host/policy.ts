import type { DomainDefinition } from "../types.js";
import type { DelegationVerdict, ParallelBudget } from "./tools/shared.js";

/**
 * Cross-domain policy (design §18), as a pure function.
 *
 * It lives apart from the service so the same rules are unit-testable without
 * a host context, and so the tool layer and the UI can never disagree about
 * whether a delegation is allowed.
 */
export function delegationVerdictOf(
  caller: DomainDefinition | undefined,
  callerDomainId: string,
  target: DomainDefinition | undefined,
  targetDomainId: string,
): DelegationVerdict {
  if (caller === undefined) {
    return {
      allowed: false,
      mode: "disabled",
      targets: [],
      message: `Caller domain "${callerDomainId}" no longer exists.`,
    };
  }
  const mode = caller.delegation.allowCrossDomain
    ? caller.delegation.crossDomainMode
    : "disabled";
  const targets = [...caller.delegation.targets];

  if (mode === "disabled") {
    return {
      allowed: false,
      mode,
      targets,
      message: `Domain "${callerDomainId}" has cross-domain access disabled, so it cannot reach "${targetDomainId}".`,
    };
  }
  if (callerDomainId === targetDomainId) {
    return {
      allowed: false,
      mode,
      targets,
      message: `"${callerDomainId}" is your own domain; answer from your own evidence instead of delegating to yourself.`,
    };
  }
  if (targets.length > 0 && !targets.includes(targetDomainId)) {
    return {
      allowed: false,
      mode,
      targets,
      message: `Domain "${callerDomainId}" may only reach ${targets.join(", ")}, and "${targetDomainId}" is not in that list.`,
    };
  }
  if (target === undefined || !target.enabled) {
    return {
      allowed: false,
      mode,
      targets,
      message: `Domain "${targetDomainId}" does not exist or is disabled.`,
    };
  }
  return { allowed: true, mode, targets, message: "" };
}

/** Parallel-run admission for one calling session. */
export function parallelBudgetOf(
  active: number,
  limit: number,
): ParallelBudget {
  return { exceeded: limit > 0 && active >= limit, limit, active };
}
