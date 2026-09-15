/**
 * Hardened child-process runner for document backends (§26.1, §28, §47).
 *
 * Every backend invocation goes through here. The contract mirrors the one the
 * git tools use, because the threat is the same shape — a document is
 * untrusted input and the backend is a powerful external program:
 *
 * - argv array only, built by the provider, never by the model, no shell;
 * - an explicit environment allow-list, so ambient secrets and proxies do not
 *   reach the backend;
 * - output is byte-capped and the process is killed when the cap or the
 *   timeout hits; a killed run is reported as `timedOut`/`truncated` rather
 *   than being confused with a backend that failed on its own;
 * - the caller's abort signal terminates the child and its descendants.
 */

import { spawn } from "node:child_process";

import { DocumentError, sanitizeBackendOutput } from "../errors.js";

export interface ProcessOptions {
  readonly cwd?: string;
  readonly timeoutMs: number;
  /** Maximum stdout bytes retained; the process is killed beyond this. */
  readonly maxStdoutBytes: number;
  /** Maximum stderr bytes retained (collection stops, the process continues). */
  readonly maxStderrBytes?: number;
  readonly signal?: AbortSignal;
  /** Extra environment entries layered over the allow-listed base. */
  readonly env?: Readonly<Record<string, string>>;
  /** Test seam: arguments between the program and the provider's own argv. */
  readonly programPrefixArgs?: readonly string[];
  /** Backend name for error reporting. */
  readonly backend: string;
  /** What the invocation is doing, for error messages. */
  readonly context: string;
}

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly truncated: boolean;
  readonly timedOut: boolean;
}

const DEFAULT_STDERR_MAX_BYTES = 16 * 1024;
const KILL_ESCALATION_MS = 500;

/**
 * Ambient variables a document backend legitimately needs. Everything else —
 * API keys, proxy settings, cloud credentials — is withheld: a converter
 * parsing a hostile document should not be able to read the deployment's
 * secrets out of its own environment (§26.5).
 */
export function buildProcessEnv(
  extra?: Readonly<Record<string, string>>,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "windir",
    "PATHEXT",
    "COMSPEC",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMDATA",
    "LOCALAPPDATA",
    "APPDATA",
  ]) {
    const value = source[key];
    if (value !== undefined) allowed[key] = value;
  }
  return { ...allowed, ...(extra ?? {}) };
}

export async function runProcess(
  program: string,
  argv: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  const args = [...(options.programPrefixArgs ?? []), ...argv];
  return await new Promise<ProcessResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(program, [...args], {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env: buildProcessEnv(options.env),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(
        new DocumentError(
          "BACKEND_UNAVAILABLE",
          `${options.backend} could not be started: ${sanitizeBackendOutput((error as Error).message)}`,
          { backend: options.backend },
        ),
      );
      return;
    }

    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutCap = Math.max(1, Math.floor(options.maxStdoutBytes));
    const stderrCap = Math.max(
      1,
      Math.floor(options.maxStderrBytes ?? DEFAULT_STDERR_MAX_BYTES),
    );

    const kill = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      const escalation = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, KILL_ESCALATION_MS);
      escalation.unref?.();
    };

    const timer = setTimeout(
      () => {
        timedOut = true;
        kill();
      },
      Math.max(1, Math.floor(options.timeoutMs)),
    );
    timer.unref?.();

    const onAbort = (): void => kill();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const detach = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= stdoutCap) {
        truncated = true;
        kill();
        return;
      }
      const remaining = stdoutCap - stdoutBytes;
      if (chunk.length > remaining) {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = stdoutCap;
        truncated = true;
        kill();
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= stderrCap) return;
      const remaining = stderrCap - stderrBytes;
      if (chunk.length > remaining) {
        stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes = stderrCap;
        return;
      }
      stderrChunks.push(chunk);
      stderrBytes += chunk.length;
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      detach();
      reject(
        new DocumentError(
          "BACKEND_UNAVAILABLE",
          `${options.backend} could not be started: ${sanitizeBackendOutput(error.message)}`,
          { backend: options.backend },
        ),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      detach();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: code,
        truncated,
        timedOut,
      });
    });
  });
}

/** Map a finished run that the provider expected to succeed onto an error. */
export function expectProcessOk(
  result: ProcessResult,
  options: {
    backend: string;
    context: string;
    fallbackCode:
      | "RENDER_FAILED"
      | "CONVERSION_FAILED"
      | "EXTRACTION_FAILED"
      | "OCR_FAILED";
  },
): void {
  if (result.timedOut) {
    throw new DocumentError(
      "BACKEND_TIMEOUT",
      `${options.backend} exceeded its time budget while ${options.context}`,
      { backend: options.backend, details: { timeoutMs: true } },
    );
  }
  if (result.exitCode === 0) return;
  const detail =
    sanitizeBackendOutput(result.stderr) ||
    sanitizeBackendOutput(result.stdout);
  throw new DocumentError(
    options.fallbackCode,
    `${options.backend} failed while ${options.context}${detail === "" ? "" : `: ${detail}`}`,
    {
      backend: options.backend,
      details: { exitCode: result.exitCode },
    },
  );
}
