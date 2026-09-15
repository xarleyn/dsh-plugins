/**
 * Capability discovery (§43) and backend health (§42).
 *
 * Health separates required from optional backends on purpose: a deployment
 * without Docling cannot extract PDFs, but it still creates documents, so the
 * subsystem reports `degraded` and names what is missing instead of declaring
 * itself down. An optional backend that was never enabled reports `disabled`,
 * which is not a fault.
 */

import type { ResolvedDocumentsConfig } from "./config.js";
import {
  createProviders,
  type ProviderSeams,
  type ProviderSet,
} from "./providers/registry.js";
import { runProcess } from "./providers/process.js";
import type {
  BackendStatus,
  CreateFormat,
  DocumentCapabilities,
  DocumentFormat,
  DocumentHealth,
} from "./types.js";
import { CONVERSION_ROUTES } from "./orchestrator/convert-document.js";
import {
  loadTemplateRegistry,
  templateNames,
  type TemplateRegistry,
} from "./templates/registry.js";

export interface HealthOptions {
  readonly config: ResolvedDocumentsConfig;
  readonly providers: ProviderSet;
  /** Probe the two process-based backends; `false` answers from configuration. */
  readonly probeProcessBackends?: boolean;
}

async function probeExecutable(
  executable: string,
  timeoutMs: number,
): Promise<BackendStatus> {
  try {
    const result = await runProcess(executable, ["--version"], {
      timeoutMs: Math.min(timeoutMs, 10_000),
      maxStdoutBytes: 8 * 1024,
      backend: executable,
      context: "probing backend availability",
    });
    return result.exitCode === 0 ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function documentHealth(
  options: HealthOptions,
): Promise<DocumentHealth> {
  const { config, providers } = options;
  const required: Record<string, BackendStatus> = {};
  const optional: Record<string, BackendStatus> = {};

  required["pandoc"] =
    options.probeProcessBackends === false
      ? "ok"
      : await probeExecutable(
          config.pandoc.executable,
          config.pandoc.timeoutMs,
        );
  required["libreoffice"] =
    options.probeProcessBackends === false
      ? "ok"
      : await probeExecutable(
          config.libreoffice.executable,
          config.libreoffice.timeoutMs,
        );
  required["docling"] =
    providers.doclingHealth === undefined
      ? "disabled"
      : await providers.doclingHealth();
  optional["typst"] = config.typst.enabled ? "ok" : "disabled";
  optional["markitdown"] =
    providers.markitdownHealth === undefined
      ? "disabled"
      : await providers.markitdownHealth();

  const requiredValues = Object.values(required);
  const status: DocumentHealth["status"] = requiredValues.every(
    (entry) => entry === "ok",
  )
    ? "ok"
    : requiredValues.every((entry) => entry !== "ok")
      ? "unavailable"
      : "degraded";
  return { status, required, optional };
}

export function documentCapabilities(options: {
  readonly config: ResolvedDocumentsConfig;
  readonly providers: ProviderSet;
  readonly templates: TemplateRegistry;
}): DocumentCapabilities {
  const config = options.config;
  const create: CreateFormat[] = [...config.create.allowFormats];
  const extract: DocumentFormat[] = [];
  if (options.providers.docling !== undefined) extract.push("docx", "pdf");
  else if (options.providers.markitdown !== undefined)
    extract.push("docx", "pdf");
  const convert = CONVERSION_ROUTES.filter(([from, to]) => {
    if (from === "md")
      return to === "docx" ? create.includes("docx") : create.includes("pdf");
    return extract.includes(from);
  }).map(([from, to]) => [from, to] as const);
  return {
    enabled: config.enabled,
    create,
    extract,
    convert,
    ocr: config.docling.enabled || options.providers.markitdown !== undefined,
    templates: templateNames(options.templates),
    pdfModes: config.typst.enabled
      ? ["auto", "office", "typst"]
      : ["auto", "office"],
  };
}

/** Load the template registry of a workspace for capability reporting. */
export async function capabilitiesForRoot(options: {
  readonly config: ResolvedDocumentsConfig;
  readonly templateRoot: string | undefined;
  readonly seams?: ProviderSeams;
}): Promise<DocumentCapabilities> {
  const templates =
    options.templateRoot === undefined
      ? await loadTemplateRegistry(undefined)
      : await loadTemplateRegistry(options.templateRoot);
  return documentCapabilities({
    config: options.config,
    providers: createProviders(options.config, options.seams ?? {}),
    templates,
  });
}
