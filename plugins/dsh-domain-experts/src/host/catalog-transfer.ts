import { createHmac, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  CATALOG_FORMAT,
  CATALOG_VERSION,
  DOMAIN_RECORD_VERSION,
  MAX_CATALOG_BYTES,
  MAX_CATALOG_DOMAINS,
  type CatalogChange,
  type CatalogImportMode,
  type CatalogPreview,
  type DomainDefinition,
} from "../types.js";
import { DomainExpertsError } from "./errors.js";
import {
  domainRecordSchema,
  errorsOf,
  normalizeDomainDefinition,
  validateDomainDefinition,
} from "./schema.js";

// Project only fields owned by the core. Provider blobs are deployment-local
// even when there is no known credential key in them.
const portableDomain = domainRecordSchema
  .omit({ formatVersion: true, createdAt: true, updatedAt: true })
  .extend({
    scope: domainRecordSchema.shape.scope.omit({ providers: true }),
  });
type PortableDomain = z.output<typeof portableDomain>;

const header = z
  .object({
    format: z.literal(CATALOG_FORMAT),
    version: z.number().int(),
    domains: z.array(z.unknown()).max(MAX_CATALOG_DOMAINS),
  })
  .strict();

function invalid(message: string): never {
  throw new DomainExpertsError("CATALOG_INVALID", message);
}

function checkDocumentSize(text: string): void {
  if (
    text.length > MAX_CATALOG_BYTES ||
    Buffer.byteLength(text, "utf8") > MAX_CATALOG_BYTES
  ) {
    invalid("A catalog JSON document may be at most 512 KiB.");
  }
}

// The structural projection excludes credential-bearing fields. These checks
// also refuse common credential syntax accidentally pasted into free text.
const SENSITIVE_TEXT = [
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/u,
  /\b(?:sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-)[a-z\d_-]{12,}\b/iu,
  /\b(?:AKIA|ASIA)[A-Z\d]{16}\b/u,
  /\beyJ[a-z\d_-]+\.[a-z\d_-]+\.[a-z\d_-]+\b/iu,
  /\b(?:bearer|basic)\s+[a-z\d+/_.~=-]{8,}/iu,
  /\b(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|password|authorization)["']?\s*[:=]\s*["']?\S/iu,
  /[a-z][a-z\d+.-]*:\/\/[^\s/?#]*@/iu,
  /[?&](?:api[_-]?key|token|access[_-]?token|password|sig(?:nature)?)=[^&#\s]+/iu,
];

function containsSensitiveText(value: unknown): boolean {
  if (typeof value === "string") {
    return SENSITIVE_TEXT.some((pattern) => pattern.test(value));
  }
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value).some(containsSensitiveText)
  );
}

function checkPortableText(domain: PortableDomain, index: number): void {
  if (containsSensitiveText(domain)) {
    throw new DomainExpertsError(
      "CATALOG_SENSITIVE_CONTENT",
      `Domain entry ${index + 1} contains credential-like text. Remove it and retry.`,
    );
  }
}

type Snapshot = ReadonlyMap<string, DomainDefinition>;

export function exportCatalog(current: Snapshot): string {
  if (current.size > MAX_CATALOG_DOMAINS) {
    invalid("A catalog document may contain at most 500 domains.");
  }
  const domains = [...current.keys()].sort().map((id, index) => {
    const domain = portableDomain.parse(current.get(id));
    checkPortableText(domain, index);
    return domain;
  });
  const text =
    JSON.stringify(
      { format: CATALOG_FORMAT, version: CATALOG_VERSION, domains },
      null,
      2,
    ) + "\n";
  checkDocumentSize(text);
  return text;
}

export function readCatalog(text: string): readonly DomainDefinition[] {
  checkDocumentSize(text);
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch {
    invalid("The file is not valid JSON.");
  }
  const result = header.safeParse(raw);
  if (!result.success) {
    invalid(
      "Expected a domain catalog with a format, integer version and up to 500 domains.",
    );
  }
  if (result.data.version !== CATALOG_VERSION) {
    throw new DomainExpertsError(
      "CATALOG_VERSION_UNSUPPORTED",
      `Catalog version ${result.data.version} is unsupported. Use version ${CATALOG_VERSION}.`,
    );
  }
  const seen = new Set<string>();
  return result.data.domains.map((entry, index) => {
    const parsed = portableDomain.safeParse(entry);
    if (!parsed.success || !isDeepStrictEqual(entry, parsed.data)) {
      invalid(
        `Domain entry ${index + 1} has missing, invalid, or non-portable fields.`,
      );
    }
    checkPortableText(parsed.data, index);
    const definition = normalizeDomainDefinition({
      ...parsed.data,
      scope: { ...parsed.data.scope, providers: {} },
      formatVersion: DOMAIN_RECORD_VERSION,
      createdAt: 0,
      updatedAt: 0,
    });
    const issue = errorsOf(validateDomainDefinition(definition))[0];
    if (issue !== undefined) {
      invalid(`Domain entry ${index + 1} has invalid ${issue.field}.`);
    }
    if (seen.has(definition.id)) {
      invalid(
        `Domain ID "${definition.id}" occurs more than once in the file.`,
      );
    }
    seen.add(definition.id);
    return definition;
  });
}

function previewToken(
  key: Uint8Array,
  current: Snapshot,
  text: string,
  mode: CatalogImportMode,
): string {
  return createHmac("sha256", key)
    .update(JSON.stringify([mode, text, [...current.values()]]))
    .digest("hex");
}

function planChanges(
  current: Snapshot,
  incoming: readonly DomainDefinition[],
  mode: CatalogImportMode,
): CatalogChange[] {
  const changes = incoming.map((definition): CatalogChange => {
    const { id } = definition;
    const existing = current.get(id);
    if (existing === undefined) return { id, action: "add" };
    if (
      isDeepStrictEqual(
        portableDomain.parse(existing),
        portableDomain.parse(definition),
      )
    ) {
      return { id, action: "unchanged" };
    }
    return { id, action: mode === "merge" ? "keep" : "update" };
  });
  if (mode === "replace") {
    const incomingIds = new Set(incoming.map(({ id }) => id));
    for (const id of current.keys()) {
      if (!incomingIds.has(id)) changes.push({ id, action: "remove" });
    }
  }
  return changes.sort((left, right) => left.id.localeCompare(right.id, "en"));
}

export function previewCatalog(
  key: Uint8Array,
  current: Snapshot,
  text: string,
  mode: CatalogImportMode,
): CatalogPreview {
  if (mode !== "merge" && mode !== "replace") invalid("Unknown import mode.");
  const incoming = readCatalog(text);
  return {
    changes: planChanges(current, incoming, mode),
    token: previewToken(key, current, text, mode),
  };
}

export function prepareCatalogWrite(
  key: Uint8Array,
  current: Snapshot,
  text: string,
  mode: CatalogImportMode,
  token: string,
  now: number,
): { readonly next: Snapshot; readonly changed: number } {
  checkDocumentSize(text);
  if (
    !/^[a-f0-9]{64}$/u.test(token) ||
    !timingSafeEqual(
      Buffer.from(previewToken(key, current, text, mode), "hex"),
      Buffer.from(token, "hex"),
    )
  ) {
    throw new DomainExpertsError(
      "CATALOG_PREVIEW_STALE",
      "The catalog, file, or import mode changed. Preview the import again.",
    );
  }
  const incoming = readCatalog(text);
  const changes = planChanges(current, incoming, mode);
  const byId = new Map(
    incoming.map((definition) => [definition.id, definition]),
  );
  const next = new Map(current);
  let changed = 0;
  for (const { id, action } of changes) {
    if (action === "remove") {
      next.delete(id);
      changed += 1;
    } else if (action === "add" || action === "update") {
      const definition = byId.get(id)!;
      const previous = current.get(id);
      next.set(id, {
        ...definition,
        scope: {
          ...definition.scope,
          providers: previous?.scope.providers ?? {},
        },
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
      changed += 1;
    }
  }
  return { next, changed };
}
