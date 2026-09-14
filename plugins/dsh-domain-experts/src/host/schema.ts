import { z } from "zod";
import {
  CROSS_DOMAIN_MODES,
  DOMAIN_ID_PATTERN,
  DOMAIN_RECORD_VERSION,
  MAX_INSTRUCTIONS_LENGTH,
  RESERVED_DOMAIN_IDS,
  defaultMemoryNamespace,
  emptyDomainDraft,
  type DomainDefinition,
  type DomainSummary,
  type MemoryRecord,
} from "../types.js";
import { DomainExpertsError } from "./errors.js";

/** Memory namespace grammar: lowercase segments, no escapes, no empties. */
const MEMORY_NAMESPACE_PATTERN =
  /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/u;

/** Paths are workspace-relative patterns; absolute paths and `..` escape. */
const SEGMENT_ESCAPE_PATTERN = /(^|[/\\])\.\.([/\\]|$)/u;
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[/\\]/u;

const crossDomainModeSchema = z.enum([
  "disabled",
  "expert-only",
  "direct-read",
]);

/**
 * Structural record schema. Record schemas in a storage domain are zod, not
 * Schemastery (the storage-domain contract), and every field is required —
 * the persisted format has no optional properties on purpose.
 */
export const domainRecordSchema: z.ZodType<DomainDefinition> = z.object({
  formatVersion: z.literal(DOMAIN_RECORD_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  icon: z.string(),
  color: z.string(),
  persona: z.object({ instructions: z.string() }),
  scope: z.object({
    filesystem: z.object({
      primary: z.array(z.string()),
      sharedReadOnly: z.array(z.string()),
      denied: z.array(z.string()),
    }),
    documentation: z.object({
      include: z.array(z.string()),
      exclude: z.array(z.string()),
    }),
    providers: z.record(z.string(), z.string()),
  }),
  memory: z.object({
    namespace: z.string(),
    sharedReadOnly: z.array(z.string()),
  }),
  tools: z.object({
    allow: z.array(z.string()),
    deny: z.array(z.string()),
  }),
  delegation: z.object({
    allowCrossDomain: z.boolean(),
    crossDomainMode: crossDomainModeSchema,
    targets: z.array(z.string()),
    directRead: z.array(z.string()),
    maxDepth: z.number().int().min(0),
    maxParallel: z.number().int().min(1),
  }),
  model: z.object({
    inherit: z.boolean(),
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string(),
    maxTokens: z.number().int().min(0),
  }),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
});

/** One durable memory record; the same shape host and browser see. */
export const memoryRecordSchema: z.ZodType<MemoryRecord> = z.object({
  namespace: z.string(),
  key: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
});

/**
 * True when a string is a usable memory namespace as written.
 *
 * The raw value is judged, not a normalized one: a namespace is a storage
 * partition key, and accepting `domain//payments` here while the definition
 * validator rejects it would make the two disagree about the same string.
 */
export function isValidNamespace(value: string): boolean {
  return MEMORY_NAMESPACE_PATTERN.test(value);
}

export type ValidationSeverity = "error" | "warning";
export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  readonly field: string;
  readonly message: string;
}

/** Semantic rules that structure alone cannot express. */
export function validateDomainDefinition(
  definition: DomainDefinition,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (
    severity: ValidationSeverity,
    field: string,
    message: string,
  ): void => {
    issues.push({ severity, field, message });
  };

  if (!DOMAIN_ID_PATTERN.test(definition.id)) {
    push(
      "error",
      "id",
      "Id must be lowercase letters, digits and dashes, start with a letter, and be at most 63 characters.",
    );
  }
  if (RESERVED_DOMAIN_IDS.includes(definition.id)) {
    push("error", "id", `Id "${definition.id}" is reserved.`);
  }
  if (definition.name.trim() === "") {
    push("error", "name", "Name is required.");
  }
  if (definition.persona.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    push(
      "error",
      "persona.instructions",
      `Custom instructions must be at most ${String(MAX_INSTRUCTIONS_LENGTH)} characters.`,
    );
  }
  // The composed persona goes through the harness persona template, which
  // interpolates `{{…}}`. A user-supplied sequence would either fail the child
  // start or silently substitute a deployment variable.
  if (definition.persona.instructions.includes("{{")) {
    push(
      "error",
      "persona.instructions",
      'Custom instructions must not contain "{{": the child persona is a template and would interpolate it.',
    );
  }

  const namespace = definition.memory.namespace;
  if (!MEMORY_NAMESPACE_PATTERN.test(namespace)) {
    push(
      "error",
      "memory.namespace",
      "Namespace must be lowercase segments joined by '/', e.g. domain/payments.",
    );
  }
  for (const shared of definition.memory.sharedReadOnly) {
    if (!MEMORY_NAMESPACE_PATTERN.test(shared)) {
      push(
        "error",
        "memory.sharedReadOnly",
        `Shared namespace "${shared}" is malformed.`,
      );
    } else if (shared === namespace) {
      push(
        "warning",
        "memory.sharedReadOnly",
        `Shared namespace "${shared}" is already the private namespace.`,
      );
    }
  }
  if (
    new Set(definition.memory.sharedReadOnly).size !==
    definition.memory.sharedReadOnly.length
  ) {
    push(
      "warning",
      "memory.sharedReadOnly",
      "Duplicate shared namespaces are collapsed on save.",
    );
  }

  for (const [field, paths] of [
    ["scope.filesystem.primary", definition.scope.filesystem.primary],
    [
      "scope.filesystem.sharedReadOnly",
      definition.scope.filesystem.sharedReadOnly,
    ],
    ["scope.filesystem.denied", definition.scope.filesystem.denied],
  ] as const) {
    for (const path of paths) {
      const reason = pathProblem(path);
      if (reason !== null)
        push("error", field, `Path "${path}" is invalid: ${reason}`);
    }
  }
  const denied = new Set(definition.scope.filesystem.denied);
  for (const [field, paths] of [
    ["scope.filesystem.primary", definition.scope.filesystem.primary],
    [
      "scope.filesystem.sharedReadOnly",
      definition.scope.filesystem.sharedReadOnly,
    ],
  ] as const) {
    for (const path of paths) {
      if (denied.has(path)) {
        push(
          "warning",
          field,
          `Path "${path}" is both allowed and denied; the denial wins.`,
        );
      }
    }
  }

  const allow = new Set(definition.tools.allow);
  for (const name of definition.tools.deny) {
    if (allow.has(name)) {
      push("error", "tools.deny", `Tool "${name}" is both allowed and denied.`);
    }
  }
  if (
    definition.delegation.allowCrossDomain &&
    definition.delegation.crossDomainMode === "disabled"
  ) {
    push(
      "warning",
      "delegation.crossDomainMode",
      "Cross-domain access is enabled but its mode is disabled; no delegation will be allowed.",
    );
  }
  if (
    !definition.delegation.allowCrossDomain &&
    definition.delegation.crossDomainMode !== "disabled"
  ) {
    push(
      "warning",
      "delegation.allowCrossDomain",
      "Cross-domain access is off, so the selected mode is unused.",
    );
  }
  if (
    !Number.isSafeInteger(definition.delegation.maxDepth) ||
    definition.delegation.maxDepth < 0
  ) {
    push(
      "error",
      "delegation.maxDepth",
      "Max delegation depth must be a non-negative integer.",
    );
  }
  if (
    !Number.isSafeInteger(definition.delegation.maxParallel) ||
    definition.delegation.maxParallel < 1
  ) {
    push(
      "error",
      "delegation.maxParallel",
      "Max parallel experts must be at least 1.",
    );
  }
  if (
    !definition.model.inherit &&
    definition.model.provider.trim() === "" &&
    definition.model.model.trim() === ""
  ) {
    push(
      "error",
      "model",
      "Select a provider and model, or switch back to inheriting from the caller.",
    );
  }
  if (definition.model.maxTokens < 0) {
    push(
      "error",
      "model.maxTokens",
      "Max tokens must be a non-negative integer.",
    );
  }

  return issues;
}

export function errorsOf(
  issues: readonly ValidationIssue[],
): readonly ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return errorsOf(issues).length > 0;
}

/** `null` when the path is usable, otherwise the reason it is not. */
export function pathProblem(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed === "") return "empty";
  if (trimmed.startsWith("/") || WINDOWS_ABSOLUTE_PATTERN.test(trimmed)) {
    return "absolute paths are outside the workspace";
  }
  if (SEGMENT_ESCAPE_PATTERN.test(trimmed))
    return '".." segments escape the workspace';
  if (trimmed.includes("\0")) return "NUL byte";
  return null;
}

/** Canonical form: trimmed, without a leading `./`, separators normalized. */
export function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/")
    .replace(/\/$/u, "");
}

/** Canonical form of a memory namespace. */
export function normalizeNamespace(namespace: string): string {
  return namespace
    .trim()
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\/{2,}/gu, "/");
}

function normalizeList(
  values: readonly string[],
  normalize: (v: string) => string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const next = normalize(value);
    if (next === "" || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

/**
 * Canonicalize a definition before it is persisted or compared. Idempotent, so
 * an update that changes nothing produces an identical record.
 */
export function normalizeDomainDefinition(
  definition: DomainDefinition,
): DomainDefinition {
  const namespace =
    normalizeNamespace(definition.memory.namespace) ||
    defaultMemoryNamespace(definition.id);
  return {
    ...definition,
    formatVersion: DOMAIN_RECORD_VERSION,
    name: definition.name.trim(),
    description: definition.description.trim(),
    persona: { instructions: definition.persona.instructions.trim() },
    scope: {
      filesystem: {
        primary: normalizeList(
          definition.scope.filesystem.primary,
          normalizePath,
        ),
        sharedReadOnly: normalizeList(
          definition.scope.filesystem.sharedReadOnly,
          normalizePath,
        ),
        denied: normalizeList(
          definition.scope.filesystem.denied,
          normalizePath,
        ),
      },
      documentation: {
        include: normalizeList(
          definition.scope.documentation.include,
          normalizePath,
        ),
        exclude: normalizeList(
          definition.scope.documentation.exclude,
          normalizePath,
        ),
      },
      providers: Object.fromEntries(
        Object.entries(definition.scope.providers).map(([key, value]) => [
          key.trim(),
          value,
        ]),
      ),
    },
    memory: {
      namespace,
      sharedReadOnly: normalizeList(
        definition.memory.sharedReadOnly,
        normalizeNamespace,
      ),
    },
    tools: {
      allow: normalizeList(definition.tools.allow, (value) => value.trim()),
      deny: normalizeList(definition.tools.deny, (value) => value.trim()),
    },
    delegation: {
      ...definition.delegation,
      crossDomainMode: CROSS_DOMAIN_MODES.includes(
        definition.delegation.crossDomainMode,
      )
        ? definition.delegation.crossDomainMode
        : "expert-only",
      targets: normalizeList(definition.delegation.targets, (value) =>
        value.trim(),
      ),
      directRead: normalizeList(
        definition.delegation.directRead,
        normalizeNamespace,
      ),
    },
    model: {
      inherit: definition.model.inherit,
      provider: definition.model.provider.trim(),
      model: definition.model.model.trim(),
      reasoningEffort: definition.model.reasoningEffort.trim(),
      maxTokens: Math.max(0, Math.trunc(definition.model.maxTokens)),
    },
  };
}

/**
 * Accept a full or partial definition from the UI or an import and produce a
 * canonical record. Structural problems fail loudly; semantic problems are the
 * caller's to reject with {@link validateDomainDefinition}.
 */
export function parseDomainDefinition(
  input: unknown,
  now: number,
): DomainDefinition {
  const record = asRecord(input);
  const id = typeof record["id"] === "string" ? record["id"] : "";
  const draft = emptyDomainDraft(id, now);
  const merged: DomainDefinition = {
    ...draft,
    name: stringOr(record["name"], id),
    description: stringOr(record["description"], ""),
    enabled: booleanOr(record["enabled"], true),
    icon: stringOr(record["icon"], ""),
    color: stringOr(record["color"], ""),
    persona: {
      instructions: stringOr(asRecord(record["persona"])["instructions"], ""),
    },
    scope: {
      filesystem: {
        primary: stringList(
          asRecord(asRecord(record["scope"])["filesystem"])["primary"],
        ),
        sharedReadOnly: stringList(
          asRecord(asRecord(record["scope"])["filesystem"])["sharedReadOnly"],
        ),
        denied: stringList(
          asRecord(asRecord(record["scope"])["filesystem"])["denied"],
        ),
      },
      documentation: {
        include: stringList(
          asRecord(asRecord(record["scope"])["documentation"])["include"],
        ),
        exclude: stringList(
          asRecord(asRecord(record["scope"])["documentation"])["exclude"],
        ),
      },
      providers: stringMap(asRecord(record["scope"])["providers"]),
    },
    memory: {
      namespace: stringOr(
        asRecord(record["memory"])["namespace"],
        defaultMemoryNamespace(id),
      ),
      sharedReadOnly: stringList(asRecord(record["memory"])["sharedReadOnly"]),
    },
    tools: {
      allow: stringList(asRecord(record["tools"])["allow"]),
      deny: stringList(asRecord(record["tools"])["deny"]),
    },
    delegation: {
      allowCrossDomain: booleanOr(
        asRecord(record["delegation"])["allowCrossDomain"],
        true,
      ),
      crossDomainMode: modeOr(
        asRecord(record["delegation"])["crossDomainMode"],
      ),
      targets: stringList(asRecord(record["delegation"])["targets"]),
      directRead: stringList(asRecord(record["delegation"])["directRead"]),
      maxDepth: intOr(asRecord(record["delegation"])["maxDepth"], 3),
      maxParallel: intOr(asRecord(record["delegation"])["maxParallel"], 3),
    },
    model: {
      inherit: booleanOr(asRecord(record["model"])["inherit"], true),
      provider: stringOr(asRecord(record["model"])["provider"], ""),
      model: stringOr(asRecord(record["model"])["model"], ""),
      reasoningEffort: stringOr(
        asRecord(record["model"])["reasoningEffort"],
        "",
      ),
      maxTokens: intOr(asRecord(record["model"])["maxTokens"], 0),
    },
    createdAt: intOr(record["createdAt"], now),
    updatedAt: intOr(record["updatedAt"], now),
  };
  const normalized = normalizeDomainDefinition(merged);
  const parsed = domainRecordSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new DomainExpertsError(
      "DOMAIN_INVALID",
      `Domain definition is not structurally valid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return normalized;
}

/** Reject a definition whose semantic rules are not satisfied. */
export function assertValidDomain(definition: DomainDefinition): void {
  const errors = errorsOf(validateDomainDefinition(definition));
  if (errors.length > 0) {
    throw new DomainExpertsError(
      "DOMAIN_INVALID",
      errors.map((issue) => `${issue.field}: ${issue.message}`).join(" "),
      { refs: errors.map((issue) => issue.field) },
    );
  }
}

export function summarizeDomain(
  definition: DomainDefinition,
  degradations = 0,
): DomainSummary {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    enabled: definition.enabled,
    icon: definition.icon,
    color: definition.color,
    primaryPaths: definition.scope.filesystem.primary.length,
    sharedPaths: definition.scope.filesystem.sharedReadOnly.length,
    memoryNamespaces: 1 + definition.memory.sharedReadOnly.length,
    tools: definition.tools.allow.length,
    degradations,
    updatedAt: definition.updatedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(asRecord(value))) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function modeOr(
  value: unknown,
): DomainDefinition["delegation"]["crossDomainMode"] {
  return typeof value === "string" &&
    (CROSS_DOMAIN_MODES as readonly string[]).includes(value)
    ? (value as DomainDefinition["delegation"]["crossDomainMode"])
    : "expert-only";
}
