/**
 * The runtime facade the tools talk to.
 *
 * One instance lives in the plugin and survives across calls, so the backend
 * registry, the concurrency semaphores and the version caches are shared
 * instead of rebuilt per request. The four operations are the whole surface:
 * everything else in this subsystem is an implementation detail behind them.
 */

import { ArtifactStore } from "./artifacts/store.js";
import {
  applyDocumentsEnvOverrides,
  resolveDocumentsConfig,
  type DocumentsConfig,
  type ResolvedDocumentsConfig,
} from "./config.js";
import {
  documentCapabilities,
  documentHealth,
  type HealthOptions,
} from "./capabilities.js";
import { DocumentError } from "./errors.js";
import {
  createProviders,
  type ProviderSeams,
  type ProviderSet,
} from "./providers/registry.js";
import {
  compareDocuments,
  resolveComparisonOptions,
} from "./comparison/compare.js";
import { readComparisonChanges } from "./comparison/artifact/reader.js";
import type {
  DocumentCompareInput,
  DocumentCompareResult,
  DocumentDiffReadInput,
  DocumentDiffReadResult,
} from "./comparison/types.js";
import { convertDocument } from "./orchestrator/convert-document.js";
import { createDocument } from "./orchestrator/create-document.js";
import { fromUrl } from "./orchestrator/fetch-document.js";
import { inspectDocument } from "./orchestrator/inspect-document.js";
import { toMarkdown } from "./orchestrator/extract-document.js";
import {
  createRuntimeDeps,
  silentDocumentLogger,
  type DocumentFetchSource,
  type DocumentLogger,
  type DocumentRuntimeDeps,
} from "./orchestrator/runtime-deps.js";
import {
  loadScopeTemplates,
  resolveDocumentScope,
  type DocumentScope,
} from "./orchestrator/scope.js";
import { loadTemplateRegistry } from "./templates/registry.js";
import { CONVERSION_ROUTES } from "./orchestrator/convert-document.js";
import type {
  DocumentCapabilities,
  DocumentConvertInput,
  DocumentConvertResult,
  DocumentCreateInput,
  DocumentCreateResult,
  DocumentFromUrlInput,
  DocumentFromUrlResult,
  DocumentHealth,
  DocumentInspectInput,
  DocumentInspectResult,
  DocumentToMarkdownInput,
  DocumentToMarkdownResult,
} from "./types.js";

export interface DocumentRuntimeOptions {
  readonly config: ResolvedDocumentsConfig;
  readonly logger?: DocumentLogger;
  readonly seams?: ProviderSeams;
  /** Pre-built registry; tests substitute stub backends here. */
  readonly providers?: ProviderSet;
  readonly now?: () => Date;
  /** Late-bound retrieval through the deployment's web provider. */
  readonly fetchSource?: DocumentFetchSource;
}

export class DocumentRuntime {
  readonly config: ResolvedDocumentsConfig;
  readonly providers: ProviderSet;
  private readonly deps: DocumentRuntimeDeps;
  private readonly seams: ProviderSeams;

  constructor(options: DocumentRuntimeOptions) {
    this.config = options.config;
    this.seams = options.seams ?? {};
    this.providers =
      options.providers ?? createProviders(this.config, this.seams);
    this.deps = createRuntimeDeps({
      config: this.config,
      providers: this.providers,
      logger: options.logger ?? silentDocumentLogger,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.fetchSource === undefined
        ? {}
        : { fetchSource: options.fetchSource }),
    });
  }

  async create(
    input: DocumentCreateInput,
    scope: DocumentScope,
  ): Promise<DocumentCreateResult> {
    return await createDocument(this.deps, input, scope);
  }

  async toMarkdown(
    input: DocumentToMarkdownInput,
    scope: DocumentScope,
  ): Promise<DocumentToMarkdownResult> {
    return await toMarkdown(this.deps, input, scope);
  }

  async convert(
    input: DocumentConvertInput,
    scope: DocumentScope,
  ): Promise<DocumentConvertResult> {
    return await convertDocument(this.deps, input, scope);
  }

  async inspect(
    input: DocumentInspectInput,
    scope: DocumentScope,
  ): Promise<DocumentInspectResult> {
    return await inspectDocument(this.deps, input, scope);
  }

  async fromUrl(
    input: DocumentFromUrlInput,
    scope: DocumentScope,
  ): Promise<DocumentFromUrlResult> {
    return await fromUrl(this.deps, input, scope);
  }

  /**
   * Deterministic comparison (§5). Disabled means absent: a deployment that
   * turned `comparison` off answers with an error rather than a lesser answer,
   * and the two tools are not registered at all.
   */
  async compare(
    input: DocumentCompareInput,
    scope: DocumentScope,
  ): Promise<DocumentCompareResult> {
    this.assertComparisonEnabled();
    return await compareDocuments(this.deps, input, scope);
  }

  async readDiff(
    input: DocumentDiffReadInput,
    scope: DocumentScope,
  ): Promise<DocumentDiffReadResult> {
    this.assertComparisonEnabled();
    const resolved = await resolveDocumentScope(this.config, scope);
    return await readComparisonChanges(resolved.store, {
      ...input,
      defaultLimit: this.config.comparison.defaultLimit,
      maxLimit: this.config.comparison.maxLimit,
    });
  }

  /** The options a comparison would run with; also the CLI's view of them. */
  comparisonOptions(input: {
    readonly mode?: DocumentCompareInput["mode"];
    readonly scope?: DocumentCompareInput["scope"];
    readonly options?: DocumentCompareInput["options"];
  }): ReturnType<typeof resolveComparisonOptions> {
    return resolveComparisonOptions(this.config.comparison, input);
  }

  private assertComparisonEnabled(): void {
    if (!this.config.comparison.enabled) {
      throw new DocumentError(
        "BACKEND_UNAVAILABLE",
        "deterministic document comparison is disabled in this deployment",
      );
    }
  }

  async health(
    options: { readonly probeProcessBackends?: boolean } = {},
  ): Promise<DocumentHealth> {
    const healthOptions: HealthOptions = {
      config: this.config,
      providers: this.providers,
      ...(options.probeProcessBackends === undefined
        ? {}
        : { probeProcessBackends: options.probeProcessBackends }),
    };
    return await documentHealth(healthOptions);
  }

  async capabilities(scope?: DocumentScope): Promise<DocumentCapabilities> {
    const templates =
      scope === undefined
        ? await loadTemplateRegistry(undefined)
        : await loadScopeTemplates(this.config, scope.workspaceRoot);
    return documentCapabilities({
      config: this.config,
      providers: this.providers,
      templates,
    });
  }

  /** Routes this runtime advertises, in documentation order. */
  routes(): readonly (readonly [string, string])[] {
    return CONVERSION_ROUTES;
  }

  /**
   * Retention sweep (§41). Meaningful only for a pinned storage root: with the
   * default per-workspace layout the plugin cannot enumerate workspaces, and a
   * sweep that guessed would delete other projects' artifacts.
   */
  async cleanup(
    options: { readonly now?: Date } = {},
  ): Promise<{ removed: string[] } | undefined> {
    if (!this.config.retention.enabled || this.config.storage.root === null)
      return undefined;
    const store = new ArtifactStore({ root: this.config.storage.root });
    const removed = await store.cleanup({
      maxAgeDays: this.config.retention.maxAgeDays,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    if (removed.removed.length > 0) {
      this.deps.logger.info("documents.retention", {
        removed: removed.removed.length,
      });
    }
    return removed;
  }
}

/** Build a runtime from raw (schema-parsed) configuration. */
export function createDocumentRuntime(options: {
  readonly config: DocumentsConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: DocumentLogger;
  readonly seams?: ProviderSeams;
  readonly providers?: ProviderSet;
  readonly now?: () => Date;
  readonly fetchSource?: DocumentFetchSource;
}): DocumentRuntime {
  const withEnv = applyDocumentsEnvOverrides(
    options.config,
    options.env ?? process.env,
  );
  const resolved = resolveDocumentsConfig(withEnv);
  if (!resolved.enabled) {
    throw new DocumentError(
      "BACKEND_UNAVAILABLE",
      "the document subsystem is disabled in this deployment",
    );
  }
  return new DocumentRuntime({
    config: resolved,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.seams === undefined ? {} : { seams: options.seams }),
    ...(options.providers === undefined
      ? {}
      : { providers: options.providers }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.fetchSource === undefined
      ? {}
      : { fetchSource: options.fetchSource }),
  });
}

export { resolveDocumentScope };
