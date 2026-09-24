import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import {
  assertIntInRange,
  isAbsoluteDirectoryPath,
  optionalText,
} from "./shared.js";

type SessionSlice = ResolvedQaSurfaceConfig["session"];

/**
 * Ceiling of `session.maxActiveRequests`. The floor is 0 — "no ceiling" — and
 * the cap only keeps a mistyped value from becoming a silently meaningless
 * one: a stand that answers sixty chat turns at once has no queue to configure.
 */
export const QA_MAX_ACTIVE_REQUESTS_MAX = 50;

/** Resolve the session domain: policy, pinning, and model selection. */
export function resolveSession(input: QaSurfaceConfig): SessionSlice {
  const policy =
    input.session?.policy ?? DEFAULT_QA_SURFACE_CONFIG.session.policy;
  const fixedSessionId = optionalText(input.session?.fixedSessionId);
  if (policy === "fixed" && fixedSessionId === null) {
    throw new TypeError(
      "dsh-qa-surface: session.fixedSessionId is required for fixed policy",
    );
  }
  // The cwd pin is the no-registry alternative to workspaceId; both pin the
  // session to one directory, so together they are a configuration error.
  const cwd = optionalText(input.session?.cwd);
  if (cwd !== null && !isAbsoluteDirectoryPath(cwd)) {
    throw new TypeError(
      "dsh-qa-surface: session.cwd must be an absolute directory path",
    );
  }
  const workspaceId = optionalText(input.session?.workspaceId);
  if (workspaceId !== null && cwd !== null) {
    throw new TypeError(
      "dsh-qa-surface: session.workspaceId and session.cwd are mutually exclusive",
    );
  }
  const provider = optionalText(input.session?.provider);
  const model = optionalText(input.session?.model);
  if ((provider === null) !== (model === null)) {
    throw new TypeError(
      "dsh-qa-surface: session.provider and session.model must be set together",
    );
  }
  const storageKey =
    input.session?.storageKey?.trim() ??
    DEFAULT_QA_SURFACE_CONFIG.session.storageKey;
  if (storageKey === "") {
    throw new TypeError("dsh-qa-surface: session.storageKey cannot be empty");
  }
  const maxActiveRequests =
    input.session?.maxActiveRequests ??
    DEFAULT_QA_SURFACE_CONFIG.session.maxActiveRequests;
  assertIntInRange(
    "session.maxActiveRequests",
    maxActiveRequests,
    0,
    QA_MAX_ACTIVE_REQUESTS_MAX,
  );
  return Object.freeze({
    policy,
    storageKey,
    cwd,
    workspaceId,
    fixedSessionId,
    agentPreset: optionalText(input.session?.agentPreset),
    provider,
    model,
    reasoningEffort: optionalText(input.session?.reasoningEffort),
    maxActiveRequests,
  });
}
