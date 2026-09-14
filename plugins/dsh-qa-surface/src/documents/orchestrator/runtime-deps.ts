/**
 * Runtime wiring shared by the four orchestrator operations.
 *
 * The runtime owns what must outlive a single call — the backend registry, the
 * concurrency semaphores and the clock — and each operation reads its
 * configuration and providers from here, so a test can substitute stub
 * backends without touching a tool definition.
 */

import type { ResolvedQaDocumentsConfig } from "../config.js";
import type { ProviderSet } from "../providers/registry.js";
import { createSemaphore, type Semaphore } from "../security/limits.js";

/** The logging surface the subsystem uses; a structural subset of PluginLogger. */
export interface DocumentLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** A logger that drops everything; the default when none is supplied. */
export const silentDocumentLogger: DocumentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface DocumentRuntimeDeps {
  readonly config: ResolvedQaDocumentsConfig;
  readonly providers: ProviderSet;
  readonly logger: DocumentLogger;
  readonly now: () => Date;
  readonly semaphores: {
    readonly render: Semaphore;
    readonly extraction: Semaphore;
    readonly ocr: Semaphore;
  };
}

export function createRuntimeDeps(options: {
  readonly config: ResolvedQaDocumentsConfig;
  readonly providers: ProviderSet;
  readonly logger?: DocumentLogger;
  readonly now?: () => Date;
}): DocumentRuntimeDeps {
  return {
    config: options.config,
    providers: options.providers,
    logger: options.logger ?? silentDocumentLogger,
    now: options.now ?? (() => new Date()),
    semaphores: {
      render: createSemaphore(options.config.workers.renderConcurrency),
      extraction: createSemaphore(options.config.workers.extractionConcurrency),
      ocr: createSemaphore(options.config.workers.ocrConcurrency),
    },
  };
}

/** Run `body` with one render slot held, releasing it on every path. */
export async function withRenderSlot<T>(
  deps: DocumentRuntimeDeps,
  signal: AbortSignal | undefined,
  body: () => Promise<T>,
): Promise<T> {
  const release = await deps.semaphores.render.acquire(signal);
  try {
    return await body();
  } finally {
    release();
  }
}

export async function withExtractionSlot<T>(
  deps: DocumentRuntimeDeps,
  signal: AbortSignal | undefined,
  body: () => Promise<T>,
): Promise<T> {
  const release = await deps.semaphores.extraction.acquire(signal);
  try {
    return await body();
  } finally {
    release();
  }
}

/** OCR runs behind its own, narrower slot (§27: `ocrConcurrency`). */
export async function withOcrSlot<T>(
  deps: DocumentRuntimeDeps,
  signal: AbortSignal | undefined,
  body: () => Promise<T>,
): Promise<T> {
  const release = await deps.semaphores.ocr.acquire(signal);
  try {
    return await body();
  } finally {
    release();
  }
}
