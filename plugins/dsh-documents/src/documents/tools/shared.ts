/**
 * What the four document tools share: the calling session's scope, the output
 * shapes they render, and the warning formatter.
 *
 * A tool is a thin adapter. It reads the session's working directory (the
 * artifact root and the allowed input roots both derive from it), hands intent
 * to the runtime, and renders the structured result for the model. No tool
 * knows a backend name beyond the one the result reports.
 */

import type {
  ParameterSchemaSpec,
  ValueSchemaSpec,
} from "@deepseek-ai/dsh-tools";

import { DocumentError } from "../errors.js";
import type { DocumentScope } from "../orchestrator/scope.js";
import type { DocumentRuntime } from "../runtime.js";
import type { DocumentFileResult, DocumentWarning } from "../types.js";

/**
 * Model-facing shape of a warning. The tool results carry code, message and
 * backend; the diagnostic `details` stay in the manifest, where they are read
 * by an operator rather than by the model.
 */
export interface ToolWarning {
  readonly code: string;
  readonly message: string;
  readonly backend?: string;
}

export function toolWarnings(
  warnings: readonly DocumentWarning[],
): ToolWarning[] {
  return warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    ...(warning.backend === undefined ? {} : { backend: warning.backend }),
  }));
}

/** Shared output-schema fragment for the `warnings` array of every tool. */
export const warningsSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      code: { type: "string", required: true },
      message: { type: "string", required: true },
      backend: { type: "string" },
    },
  },
} satisfies ValueSchemaSpec;

/** Mutable projection of a produced file for the tool result. */
export function toolFiles(files: readonly DocumentFileResult[]): {
  format: string;
  path: string;
  mediaType: string;
  size: number;
  sha256: string;
  status: string;
  error?: string;
}[] {
  return files.map((file) => ({
    format: file.format,
    path: file.path,
    mediaType: file.mediaType,
    size: file.size,
    sha256: file.sha256,
    status: file.status,
    ...(file.error === undefined ? {} : { error: file.error }),
  }));
}

/** Structural view of the execution context a tool body needs. */
export interface DocumentToolExec {
  readonly signal?: AbortSignal;
  readonly agent?: {
    readonly session: {
      readonly header: {
        readonly cwd?: string;
        readonly id?: unknown;
      };
    };
  };
}

/**
 * The options every document tool is created with.
 */
export interface DocumentToolOptions {
  readonly runtime: DocumentRuntime;
  /**
   * Extra readable input roots for the session a call comes from, resolved per
   * execution — a grant that appears (or is revoked) after the tool was
   * registered is honoured on the next call rather than at install time.
   *
   * The source is the deployment's own read fence: the plugin that fences a
   * session for a user (and therefore knows which out-of-workspace roots that
   * session may read) registers the roots here, and the document scope then
   * agrees with the fence instead of contradicting it. Absent means the
   * pipeline reads the session workspace and the configured roots only.
   */
  readonly extraInputRoots?: (sessionId?: string) => readonly string[];
}

/**
 * Resolve the session scope, failing closed: a session without a working
 * directory gets no document access rather than the host process's cwd.
 */
export function requireDocumentScope(
  exec: DocumentToolExec,
  options?: {
    readonly extraInputRoots?: (sessionId?: string) => readonly string[];
  },
): DocumentScope {
  const header = exec.agent?.session.header;
  const cwd = header?.cwd;
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new DocumentError(
      "INVALID_INPUT",
      "this tool requires a calling session with a working directory",
    );
  }
  const sessionId = header?.id === undefined ? undefined : String(header.id);
  const extraInputRoots = options?.extraInputRoots?.(sessionId) ?? [];
  return {
    workspaceRoot: cwd,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
    ...(extraInputRoots.length === 0 ? {} : { extraInputRoots }),
  };
}

export function fileParameter(): ParameterSchemaSpec[string] {
  return {
    type: "string",
    required: true,
    description:
      "Path to the document. Relative paths start at the session working directory and must " +
      "stay inside it or a configured document root.",
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function renderWarning(warning: ToolWarning): string {
  const backend = warning.backend === undefined ? "" : ` [${warning.backend}]`;
  return `warning ${warning.code}${backend}: ${warning.message}`;
}

/** One line per produced file, plus failed formats explicitly named. */
export function renderFiles(files: readonly DocumentFileResult[]): string[] {
  return files.map((file) => {
    if (file.status === "failed") {
      return `${file.format}: failed (${file.error ?? "unknown error"})`;
    }
    return `${file.format}: ${file.path} (${formatBytes(file.size)}, sha256 ${file.sha256.slice(0, 16)}…)`;
  });
}

export const ARTIFACT_NOTE =
  "The artifact directory keeps the source, the assets and manifest.json beside the outputs.";
