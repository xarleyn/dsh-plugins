/**
 * The rule draft: the editable text form of one rule, and the conversions
 * between it and the stored shape (SPEC §6.2). Every field is a string here
 * because an input needs one, so an unparseable limit stays on screen while
 * `draftToRule` reports it as an error instead of writing it.
 * @module client/sections/rule-draft
 */

import {
  listToText,
  networkFromDraft,
  networkToDraft,
  newRuleId,
  parsePositiveInt,
  textToList,
  type NetworkDraft,
} from "../format.js";
import { validateRule } from "../../rule-validation.js";
import type {
  AdapterConfig,
  AuthType,
  CleanupLevel,
  RedirectMode,
  AuthenticatedFetchRule,
} from "../../types.js";

/** Cleanup-level labels, keyed by the level list the host validates against. */
export const CLEANUP_LABELS: Readonly<Record<CleanupLevel, string>> =
  Object.freeze({
    off: "No trimming (keep every marker)",
    balanced: "Trim chrome (keep links and attachments)",
    strict: "Content only (readable text alone)",
  });

/** Rule-row badge: the adapter, plus the cleanup level when it is not the default. */
export function adapterSummary(adapter: AdapterConfig): string {
  if (adapter.type !== "confluence" || adapter.cleanup === undefined)
    return adapter.type;
  return `${adapter.type}:${adapter.cleanup}`;
}

export interface RuleDraft {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  testUrl: string;
  schemesHttp: boolean;
  hosts: string;
  ports: string;
  allowPaths: string;
  denyPaths: string;
  authType: AuthType;
  bearerRef: string;
  basicUsername: string;
  basicPasswordRef: string;
  headerName: string;
  headerRef: string;
  headerPrefix: string;
  adapterType: "none" | "jira" | "confluence";
  jiraFlavor: "server" | "cloud";
  includeComments: boolean;
  includeLinks: boolean;
  cleanup: CleanupLevel;
  network: NetworkDraft;
  redirectMode: RedirectMode;
  maxRedirects: string;
  allowedOrigins: string;
  timeoutMs: string;
  maxResponseBytes: string;
  maxBodyChars: string;
}

export function ruleToDraft(rule: AuthenticatedFetchRule): RuleDraft {
  const auth = rule.auth;
  const adapter = rule.adapter;
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    enabled: rule.enabled,
    testUrl: rule.testUrl ?? "",
    schemesHttp: rule.match.schemes?.includes("http") === true,
    hosts: listToText(rule.match.hosts),
    ports: rule.match.ports === undefined ? "" : rule.match.ports.join(", "),
    allowPaths: listToText(rule.match.allowPaths),
    denyPaths: listToText(rule.match.denyPaths),
    authType: auth.type,
    bearerRef: auth.type === "bearer" ? auth.credential : "",
    basicUsername: auth.type === "basic" ? auth.username : "",
    basicPasswordRef: auth.type === "basic" ? auth.passwordCredential : "",
    headerName: auth.type === "header" ? auth.headerName : "",
    headerRef: auth.type === "header" ? auth.credential : "",
    headerPrefix: auth.type === "header" ? (auth.prefix ?? "") : "",
    adapterType: adapter?.type ?? "none",
    jiraFlavor: adapter?.jiraFlavor ?? "server",
    includeComments: adapter?.includeComments ?? false,
    includeLinks: adapter?.includeLinks ?? false,
    cleanup: adapter?.cleanup ?? "balanced",
    network: networkToDraft(rule.networkPolicy),
    redirectMode: rule.redirects?.mode ?? "same-origin",
    maxRedirects:
      rule.redirects?.maxRedirects === undefined
        ? ""
        : String(rule.redirects.maxRedirects),
    allowedOrigins: listToText(rule.redirects?.allowedOrigins),
    timeoutMs:
      rule.limits?.timeoutMs === undefined ? "" : String(rule.limits.timeoutMs),
    maxResponseBytes:
      rule.limits?.maxResponseBytes === undefined
        ? ""
        : String(rule.limits.maxResponseBytes),
    maxBodyChars:
      rule.limits?.maxBodyChars === undefined
        ? ""
        : String(rule.limits.maxBodyChars),
  };
}

export function emptyDraft(): RuleDraft {
  return {
    id: newRuleId(),
    name: "",
    description: "",
    enabled: true,
    testUrl: "",
    schemesHttp: false,
    hosts: "",
    ports: "",
    allowPaths: "",
    denyPaths: "",
    authType: "bearer",
    bearerRef: "",
    basicUsername: "",
    basicPasswordRef: "",
    headerName: "",
    headerRef: "",
    headerPrefix: "",
    adapterType: "none",
    jiraFlavor: "server",
    includeComments: false,
    includeLinks: false,
    cleanup: "balanced",
    network: networkToDraft(undefined),
    redirectMode: "same-origin",
    maxRedirects: "",
    allowedOrigins: "",
    timeoutMs: "",
    maxResponseBytes: "",
    maxBodyChars: "",
  };
}

export function draftToRule(draft: RuleDraft): {
  rule: AuthenticatedFetchRule;
  errors: string[];
} {
  const errors: string[] = [];
  const hosts = textToList(draft.hosts);
  const portsText = draft.ports.trim();
  let ports: number[] | undefined;
  if (portsText.length > 0) {
    const parts = portsText.split(/[,\s]+/u);
    if (parts.some((part) => !/^\d+$/u.test(part)))
      errors.push("Ports must be integers separated by commas.");
    else ports = parts.map((part) => Number(part));
  }
  const auth: AuthenticatedFetchRule["auth"] =
    draft.authType === "none"
      ? { type: "none" }
      : draft.authType === "bearer"
        ? { type: "bearer", credential: draft.bearerRef.trim() }
        : draft.authType === "basic"
          ? {
              type: "basic",
              username: draft.basicUsername.trim(),
              passwordCredential: draft.basicPasswordRef.trim(),
            }
          : {
              type: "header",
              headerName: draft.headerName.trim(),
              credential: draft.headerRef.trim(),
              ...(draft.headerPrefix.trim().length > 0
                ? { prefix: draft.headerPrefix }
                : {}),
            };
  const maxRedirects = parsePositiveInt(draft.maxRedirects);
  if (draft.maxRedirects.trim() !== "" && maxRedirects === undefined) {
    errors.push("Max redirects must be a non-negative integer.");
  }
  const allowedOrigins = textToList(draft.allowedOrigins);
  const rule: AuthenticatedFetchRule = {
    id: draft.id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    match: {
      ...(draft.schemesHttp ? { schemes: ["https", "http" as const] } : {}),
      hosts,
      ...(ports === undefined ? {} : { ports }),
      ...(textToList(draft.allowPaths).length > 0
        ? { allowPaths: textToList(draft.allowPaths) }
        : {}),
      ...(textToList(draft.denyPaths).length > 0
        ? { denyPaths: textToList(draft.denyPaths) }
        : {}),
    },
    auth,
    networkPolicy: networkFromDraft(draft.network),
    redirects: {
      mode: draft.redirectMode,
      ...(maxRedirects === undefined ? {} : { maxRedirects }),
      ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
    },
    limits: buildLimits(draft, errors),
  };
  if (draft.adapterType !== "none") {
    rule.adapter =
      draft.adapterType === "jira"
        ? {
            type: "jira",
            ...(draft.jiraFlavor !== "server"
              ? { jiraFlavor: draft.jiraFlavor }
              : {}),
            ...(draft.includeComments ? { includeComments: true } : {}),
            ...(draft.includeLinks ? { includeLinks: true } : {}),
          }
        : {
            type: "confluence",
            ...(draft.cleanup !== "balanced" ? { cleanup: draft.cleanup } : {}),
          };
  }
  if (draft.description.trim().length > 0)
    rule.description = draft.description.trim();
  if (draft.testUrl.trim().length > 0) rule.testUrl = draft.testUrl.trim();
  errors.push(...validateRule(rule, 0));
  return { rule, errors: [...new Set(errors)] };
}

function buildLimits(
  draft: RuleDraft,
  errors: string[],
): AuthenticatedFetchRule["limits"] {
  const limits: NonNullable<AuthenticatedFetchRule["limits"]> = {};
  const timeout = parsePositiveInt(draft.timeoutMs);
  if (draft.timeoutMs.trim() !== "" && timeout === undefined)
    errors.push("Timeout must be a positive integer.");
  if (timeout !== undefined) limits.timeoutMs = timeout;
  const bytes = parsePositiveInt(draft.maxResponseBytes);
  if (draft.maxResponseBytes.trim() !== "" && bytes === undefined)
    errors.push("Max response size must be a positive integer.");
  if (bytes !== undefined) limits.maxResponseBytes = bytes;
  const chars = parsePositiveInt(draft.maxBodyChars);
  if (draft.maxBodyChars.trim() !== "" && chars === undefined)
    errors.push("Max body chars must be a positive integer.");
  if (chars !== undefined) limits.maxBodyChars = chars;
  return limits;
}
