/**
 * `@yadsh/dsh-documents`: the managed document pipeline as its own DSH plugin.
 *
 * The pipeline existed inside `dsh-qa-surface` and grew into a subsystem in its
 * own right — backends, an artifact store, templates, OCR policy, retention,
 * limits — with nothing QA-specific about it: it reads the calling session's
 * working directory, registers plain agent tools, and fetches online sources
 * through whatever web provider the deployment configured. It is therefore its
 * own service plugin here: it owns the live configuration source (the
 * `documents` settings namespace), the tool registration, and the artifact
 * retention sweep.
 *
 * The tool names are unchanged (`document_create`, `document_to_markdown`,
 * `document_from_url`, `document_convert`, `document_inspect`), so a deployment
 * that already allow-lists them keeps working; only where the tools come from
 * changes.
 *
 * @module @yadsh/dsh-documents
 */

import { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-tools";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import { ConfigSchema } from "./schema.js";
import { DOCUMENTS_SETTINGS_NAMESPACE } from "./shared/settings.js";
import { CONTRACT_REVIEW_SKILL, mountDocumentSkills } from "./skills.js";
import {
  applyDocumentsEnvOverrides,
  resolveDocumentsConfig,
  type DocumentsConfig,
  type ResolvedDocumentsConfig,
} from "./documents/config.js";
import {
  DOCUMENT_TOOL_NAMES,
  DocumentError,
  installDocumentSubsystem,
  type DocumentConvertInput,
  type DocumentConvertResult,
  type DocumentFetchSource,
  type DocumentInspectInput,
  type DocumentInspectResult,
  type DocumentRuntime,
  type DocumentScope,
  type DocumentSubsystem,
  type DocumentToMarkdownInput,
  type DocumentToMarkdownResult,
} from "./documents/index.js";

/**
 * The slice of the harness web service `document_from_url` uses. A deployment
 * may install no web provider at all, and the service arrives from a package
 * this plugin does not link, so the injected context is read structurally.
 */
interface WebFetchSeam {
  fetch(
    request: { readonly url: string },
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<DocumentFetchSource>>>;
}

export { ConfigSchema } from "./schema.js";
export { DOCUMENTS_SETTINGS_NAMESPACE } from "./shared/settings.js";
export {
  buildDocumentSkillsConfig,
  CONTRACT_REVIEW_SKILL,
  DOCUMENT_SKILL_PROVIDER_NAME,
  DOCUMENT_SKILLS_DIR,
  mountDocumentSkills,
} from "./skills.js";
export * from "./documents/index.js";

/** Cordis plugin ID; the settings namespace lives in `shared/settings.ts`. */
export const name = "documents";
export const inject = ["tools"];

export type Config = DocumentsConfig;
export const Config = ConfigSchema;

/**
 * The subsystem as other Host plugins see it.
 *
 * The four operations and nothing else: a sibling plugin that wants a document
 * preview converts or extracts through the same runtime, its provider registry,
 * its semaphores and its limits, instead of standing up a second pipeline.
 * There is still no Remote face — this service lives in the Host process, so a
 * browser never reaches it directly (§7), and a deployment that never calls it
 * pays nothing for it.
 */
export interface DocumentsFace {
  toMarkdown(
    input: DocumentToMarkdownInput,
    scope: DocumentScope,
  ): Promise<DocumentToMarkdownResult>;
  convert(
    input: DocumentConvertInput,
    scope: DocumentScope,
  ): Promise<DocumentConvertResult>;
  inspect(
    input: DocumentInspectInput,
    scope: DocumentScope,
  ): Promise<DocumentInspectResult>;
}

/**
 * DSH Host plugin: registers the document tools, keeps them in step with the
 * `documents` settings namespace, and schedules the artifact retention sweep.
 */
export class DocumentsPlugin {
  static inject = inject;
  static Config = ConfigSchema;

  private readonly hostCtx: Context;
  private readonly entryConfig: DocumentsConfig;
  private readonly logger: PluginLogger;
  /** Live configuration: the settings section once it is installed. */
  private configSource: () => DocumentsConfig;
  private documents: DocumentSubsystem | undefined;
  /** Disposer of the face published to sibling Host plugins. */
  private documentsFace: (() => void) | undefined;
  /** Identity of the installed subsystem, so unchanged config is a no-op. */
  private documentsKey: string | undefined;
  /** Resolved per call: a provider that arrives late is still picked up. */
  private web: WebFetchSeam | undefined;

  constructor(ctx: Context, config: DocumentsConfig = {}) {
    this.logger = getPluginLogger({
      pluginId: "dsh-documents",
      console: "trace",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    ctx.effect(() => async () => this.logger.close(), "dsh-documents.logger");
    this.hostCtx = ctx;
    this.entryConfig = structuredClone(config);
    this.configSource = () => this.entryConfig;

    ctx.inject(["settings"], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        DOCUMENTS_SETTINGS_NAMESPACE,
        ConfigSchema,
        this.entryConfig,
        {
          setSource: (current) => {
            this.configSource = current;
          },
          onChange: () => {
            this.refresh();
          },
        },
      );
    });

    // Retrieval for `document_from_url` is the web layer's business: this plugin
    // never opens a socket of its own, so the deployment's rules, credentials,
    // address policy and byte caps decide what may be read.
    ctx.inject(["web"], (webContext) => {
      this.web = (webContext as unknown as { web?: WebFetchSeam }).web;
      webContext.effect(
        () => () => {
          this.web = undefined;
        },
        "dsh-documents.web-fetch-source",
      );
    });

    this.refresh();
    // The skill teaches the comparison workflow, so it is mounted with it. The
    // decision is taken once, at startup: a Cordis plugin mount is not a
    // subscription, and an operator who turns comparison off later still gets
    // an honest answer from the tools rather than a missing instruction.
    const startup = this.resolved();
    if (startup.enabled && startup.comparison.enabled) {
      mountDocumentSkills(ctx);
      this.logger.info("documents.skill", { skill: CONTRACT_REVIEW_SKILL });
    }
    ctx.effect(
      () => () => {
        this.documentsFace?.();
        this.documentsFace = undefined;
        this.documents?.dispose();
        this.documents = undefined;
        this.documentsKey = undefined;
      },
      "dsh-documents.tools",
    );
  }

  /** The configuration the running subsystem resolves to. */
  resolved(): ResolvedDocumentsConfig {
    return resolveDocumentsConfig(this.configSource());
  }

  /**
   * Install, rebuild or tear down the subsystem. The raw entry is resolved with
   * the documented environment overrides applied, so a deployment can point
   * `DSH_DOCUMENTS_STORAGE_ROOT` at a shared volume without touching the
   * settings namespace; the settings layer stays authoritative for everything it
   * declares.
   */
  private refresh(): void {
    const withEnv = applyDocumentsEnvOverrides(
      this.configSource(),
      process.env,
    );
    const resolved = resolveDocumentsConfig(withEnv);
    const key = resolved.enabled ? JSON.stringify(resolved) : undefined;
    if (key === this.documentsKey) return;
    this.documents?.dispose();
    this.documents = undefined;
    this.documentsKey = key;
    if (key === undefined) {
      this.logger.info("documents.disabled", { tools: DOCUMENT_TOOL_NAMES });
      return;
    }
    this.documents = installDocumentSubsystem(this.hostCtx, {
      config: withEnv,
      logger: this.logger,
      register: (definition) => this.hostCtx.tools.register(definition),
      fetchSource: async (url, signal) => {
        const web = this.web;
        if (web === undefined)
          throw new DocumentError(
            "BACKEND_UNAVAILABLE",
            "this deployment has no web fetch provider, so online sources cannot be read",
          );
        return await web.fetch({ url }, signal);
      },
    });
    this.publishFace();
  }

  /**
   * Offer the installed runtime to sibling Host plugins, replacing whatever a
   * previous configuration published. The callbacks read `this.documents` at
   * call time, so a rebuild that swaps the subsystem never leaves a caller
   * holding a disposed one.
   */
  private publishFace(): void {
    this.documentsFace?.();
    this.documentsFace = undefined;
    if (this.documents === undefined) return;
    this.documentsFace = this.hostCtx.provide("documents", {
      toMarkdown: (input, scope) => this.runtime().toMarkdown(input, scope),
      convert: (input, scope) => this.runtime().convert(input, scope),
      inspect: (input, scope) => this.runtime().inspect(input, scope),
    } satisfies DocumentsFace);
  }

  /** The live subsystem, or a refusal when no configuration enabled it. */
  private runtime(): DocumentRuntime {
    const documents = this.documents;
    if (documents === undefined) {
      throw new DocumentError(
        "BACKEND_UNAVAILABLE",
        "the document subsystem is not installed in this deployment",
      );
    }
    return documents.runtime;
  }
}

export default DocumentsPlugin;
