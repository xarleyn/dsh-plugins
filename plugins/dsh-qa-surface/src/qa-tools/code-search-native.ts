import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";

export interface CodeHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

interface NativeResult {
  readonly hits: CodeHit[];
  readonly filesScanned: number;
  readonly skipped: number;
  readonly truncated: boolean;
}

function isCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseResult(stdout: string, limit: number): NativeResult {
  const result: unknown = JSON.parse(stdout);
  if (result === null || typeof result !== "object")
    throw new Error("Invalid runner output");
  const { version, hits, filesScanned, skipped, truncated } = result as Record<
    string,
    unknown
  >;
  if (
    version !== 1 ||
    !isCounter(filesScanned) ||
    filesScanned > 1000 ||
    !isCounter(skipped) ||
    skipped > 10000 ||
    typeof truncated !== "boolean" ||
    !Array.isArray(hits) ||
    hits.length > limit
  ) {
    throw new Error("Invalid runner output");
  }
  const checked = (hits as unknown[]).map((hit): CodeHit => {
    if (hit === null || typeof hit !== "object")
      throw new Error("Invalid runner hit");
    const { path, line, text } = hit as Record<string, unknown>;
    if (
      typeof path !== "string" ||
      !isCounter(line) ||
      line < 1 ||
      typeof text !== "string"
    )
      throw new Error("Invalid runner hit");
    return { path, line, text: text.slice(0, 500) };
  });
  return { hits: checked, filesScanned, skipped, truncated };
}

/** The host has already authorized root and resolved path inside it. */
export async function searchCodeNative(
  root: string,
  path: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<NativeResult | undefined> {
  const program = process.env.QA_CODE_SEARCH_BIN;
  if (
    !program ||
    process.platform !== "linux" ||
    /[\uD800-\uDFFF]/u.test(query)
  )
    return undefined;
  if (!isAbsolute(program))
    throw new Error("QA_CODE_SEARCH_BIN must be an absolute path.");

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      program,
      [],
      {
        env: {},
        cwd: "/",
        encoding: "utf8",
        timeout: 3500,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
        signal,
      },
      (error, output) => {
        if (error) {
          reject(
            signal?.aborted
              ? signal.reason
              : new Error(
                  "Native code search failed or exceeded its time budget.",
                ),
          );
        } else {
          resolve(output);
        }
      },
    );
    child.stdin?.on("error", () => {
      // execFile reports the child's outcome, including an early exit.
    });
    child.stdin?.end(JSON.stringify({ version: 1, root, path, query, limit }));
  });
  try {
    return parseResult(stdout, limit);
  } catch {
    throw new Error("Native code search returned an incompatible response.");
  }
}
