/**
 * Template registry (§12.2).
 *
 * A deployment describes its templates in a `manifest.yml` beside the
 * template files:
 *
 * ```yaml
 * templates:
 *   default:
 *     docx: ./docx/default.docx
 *   qa-report:
 *     docx: ./docx/qa-report.docx
 *     typst: ./typst/qa-report
 * ```
 *
 * Every declared path is resolved against the template root and must stay
 * inside it: a registry file is operator input, but it is read from the
 * workspace, so it gets the same containment treatment as everything else
 * (§26.2).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { DocumentError, asDocumentError } from "../errors.js";
import { canonicalizeForContainment, isInsideRoot } from "../security/paths.js";
import type { DocumentWarning } from "../types.js";

export const TEMPLATE_MANIFEST_FILE = "manifest.yml";

export interface DocumentTemplate {
  readonly name: string;
  /** Absolute path of the reference DOCX, when the template declares one. */
  readonly docx?: string;
  /** Absolute path of the Typst template directory, when it declares one. */
  readonly typst?: string;
}

export interface TemplateRegistry {
  /** Absolute template root, when the workspace provides one. */
  readonly root?: string;
  readonly templates: ReadonlyMap<string, DocumentTemplate>;
  readonly warnings: readonly DocumentWarning[];
}

/** The template name that always resolves, with or without a registry. */
export const BUILTIN_TEMPLATE_NAME = "default";

const EMPTY_REGISTRY: TemplateRegistry = {
  templates: new Map(),
  warnings: [],
};

/** Located registry file inside a candidate root. */
export async function findTemplateManifest(
  root: string,
): Promise<string | undefined> {
  const candidate = path.join(root, TEMPLATE_MANIFEST_FILE);
  try {
    const raw = await readFile(candidate, "utf8");
    return raw.trim() === "" ? undefined : candidate;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * Load a registry from a template root. A missing root, a missing manifest or
 * an unreadable document all leave the builtin default in place and report a
 * warning — a broken template directory must not stop the agent from writing a
 * plain document, but it must not be silent either.
 */
export async function loadTemplateRegistry(
  root: string | undefined,
): Promise<TemplateRegistry> {
  if (root === undefined) return EMPTY_REGISTRY;
  const canonicalRoot = await canonicalizeForContainment(root);
  const manifestPath = await findTemplateManifest(canonicalRoot);
  if (manifestPath === undefined) {
    return {
      root: canonicalRoot,
      templates: new Map(),
      warnings: [
        {
          code: "METADATA_PARTIALLY_EXTRACTED",
          message: `no ${TEMPLATE_MANIFEST_FILE} found under the configured template root; only the builtin "default" template is available`,
          details: { root: canonicalRoot },
        },
      ],
    };
  }

  let document: unknown;
  try {
    document = parseYaml(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return {
      root: canonicalRoot,
      templates: new Map(),
      warnings: [
        {
          code: "METADATA_PARTIALLY_EXTRACTED",
          message: `the template registry is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
          details: { manifest: TEMPLATE_MANIFEST_FILE },
        },
      ],
    };
  }

  const section = (document as { templates?: unknown } | null)?.templates;
  if (section === null || typeof section !== "object") {
    throw new DocumentError(
      "INVALID_TEMPLATE",
      `${TEMPLATE_MANIFEST_FILE} must declare a "templates" mapping`,
      { details: { manifest: TEMPLATE_MANIFEST_FILE } },
    );
  }

  const templates = new Map<string, DocumentTemplate>();
  for (const [rawName, rawEntry] of Object.entries(
    section as Record<string, unknown>,
  )) {
    const name = rawName.trim();
    if (name === "") continue;
    if (rawEntry === null || typeof rawEntry !== "object") {
      throw new DocumentError(
        "INVALID_TEMPLATE",
        `template "${name}" must be a mapping with a docx and/or typst path`,
        { details: { template: name } },
      );
    }
    const entry = rawEntry as Record<string, unknown>;
    const docx = readString(entry["docx"]);
    const typst = readString(entry["typst"]);
    if (docx === undefined && typst === undefined) {
      throw new DocumentError(
        "INVALID_TEMPLATE",
        `template "${name}" declares neither a docx nor a typst path`,
        { details: { template: name } },
      );
    }
    templates.set(name, {
      name,
      ...(docx === undefined
        ? {}
        : { docx: resolveTemplatePath(canonicalRoot, docx, name, "docx") }),
      ...(typst === undefined
        ? {}
        : { typst: resolveTemplatePath(canonicalRoot, typst, name, "typst") }),
    });
  }
  return { root: canonicalRoot, templates, warnings: [] };
}

function resolveTemplatePath(
  root: string,
  declared: string,
  templateName: string,
  kind: string,
): string {
  const resolved = path.resolve(root, declared);
  if (!isInsideRoot(root, resolved)) {
    throw new DocumentError(
      "PATH_NOT_ALLOWED",
      `the ${kind} path of template "${templateName}" leaves the template root`,
      { details: { template: templateName } },
    );
  }
  return resolved;
}

export function templateNames(registry: TemplateRegistry): string[] {
  return [
    ...new Set([BUILTIN_TEMPLATE_NAME, ...registry.templates.keys()]),
  ].sort();
}

/** Load a registry from a candidate root, defaulting to a file-system probe. */
export async function loadTemplateRegistryFrom(
  roots: readonly (string | undefined)[],
  probe: (candidate: string) => Promise<boolean>,
): Promise<TemplateRegistry> {
  for (const candidate of roots) {
    if (candidate === undefined) continue;
    try {
      if (await probe(candidate)) return await loadTemplateRegistry(candidate);
    } catch (error) {
      throw asDocumentError(error, "INVALID_TEMPLATE");
    }
  }
  return EMPTY_REGISTRY;
}
