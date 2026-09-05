import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create a throwaway directory for plugin-log file output. Tests collect the
 * records back with {@link readLogLines} and must clean the directory up
 * (usually via an `afterEach` that removes every returned path).
 */
export async function makeLogDir(prefix = "dsh-plugin-logs-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Parse every NDJSON record written under a log directory (all files). */
export async function readLogLines(dir: string): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = [];
  for (const entry of await readdir(dir)) {
    const text = await readFile(join(dir, entry), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim() !== "") lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return lines;
}
