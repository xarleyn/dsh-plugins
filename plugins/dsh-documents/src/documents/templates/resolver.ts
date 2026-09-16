/**
 * Template resolution (§12.3).
 *
 * ```text
 * requested template
 *   ↓ (absent)
 * project default
 *   ↓ (absent)
 * builtin default
 * ```
 *
 * A requested template that does not exist is an error, never a silent
 * fallback: a report rendered in the wrong corporate layout is worse than a
 * failed call the operator can read. The builtin `default` name resolves
 * without a registry entry — it means "the document backend's own defaults".
 */

import { DocumentError } from "../errors.js";
import type { DocumentWarning } from "../types.js";
import {
  BUILTIN_TEMPLATE_NAME,
  type DocumentTemplate,
  type TemplateRegistry,
} from "./registry.js";

export interface ResolvedTemplate {
  readonly name: string;
  readonly template?: DocumentTemplate;
  /** How the effective name was chosen. */
  readonly source: "requested" | "project-default" | "builtin";
}

export interface TemplateResolution {
  readonly resolved: ResolvedTemplate;
  readonly warnings: readonly DocumentWarning[];
}

export function resolveTemplate(
  registry: TemplateRegistry,
  requested: string | undefined,
  projectDefault: string,
): TemplateResolution {
  if (requested !== undefined && requested.trim() !== "") {
    const name = requested.trim();
    const template = registry.templates.get(name);
    if (template !== undefined) {
      return {
        resolved: { name, template, source: "requested" },
        warnings: [],
      };
    }
    if (name === BUILTIN_TEMPLATE_NAME) {
      return { resolved: { name, source: "builtin" }, warnings: [] };
    }
    throw new DocumentError(
      "TEMPLATE_NOT_FOUND",
      `template "${name}" is not registered (available: ${[
        ...[registry.templates.keys()],
      ]
        .sort()
        .join(", ")})`,
      { details: { template: name } },
    );
  }

  const name =
    projectDefault.trim() === ""
      ? BUILTIN_TEMPLATE_NAME
      : projectDefault.trim();
  if (name === BUILTIN_TEMPLATE_NAME) {
    return { resolved: { name, source: "builtin" }, warnings: [] };
  }
  const template = registry.templates.get(name);
  if (template === undefined) {
    throw new DocumentError(
      "TEMPLATE_NOT_FOUND",
      `the configured default template "${name}" is not registered`,
      { details: { template: name } },
    );
  }
  return {
    resolved: { name, template, source: "project-default" },
    warnings: [
      {
        code: "TEMPLATE_DEFAULTED",
        message: `no template was requested; the deployment default "${name}" was applied`,
        details: { template: name },
      },
    ],
  };
}
