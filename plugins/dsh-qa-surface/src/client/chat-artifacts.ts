import type { QaArtifactView } from "../types.js";

/**
 * The files one turn produced, read out of the tool results that produced them.
 *
 * A document the agent made is the result of the conversation, but nothing
 * carries it into the transcript: it is a file in the chat's own workspace, and
 * the only trace it leaves is the line the producing tool rendered. Reading
 * those lines is what turns a paragraph that mentions a file into a card a
 * person can open and download, so the reader does not have to know the files
 * tab exists to receive what they asked for.
 *
 * The line shape belongs to the tools of `@yadsh/dsh-documents`, which report
 * every produced file as `<format>: <path> (<size>, sha256 …)`. The path is the
 * workspace-relative name the tool was asked to report: an absolute path would
 * both refuse at the workspace fence and print the account's own directory into
 * the answer, so a line carrying one is ignored rather than rendered.
 */

/** The tools that hand a file to the user, and the formats each reports. */
const PRODUCED_FORMATS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    document_create: ["docx", "pdf"],
    document_convert: ["docx", "pdf", "md"],
    document_to_markdown: ["markdown"],
    document_from_url: ["markdown"],
  });

/** One reported file: `<format>: <path>` with an optional `(<size>, …)`. */
const FILE_LINE = /^([a-z][a-z0-9]*):\s+(\S+)(?:\s+\(([^)]*)\))?$/u;

/** A path spelled from the filesystem root, which the fence would refuse. */
function isAbsolutePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(value)
  );
}

/** `12.3 KiB` back to bytes; an unparseable size reads as unknown. */
const UNIT_SCALES: Readonly<Record<string, number>> = Object.freeze({
  b: 1,
  kib: 1_024,
  mib: 1_048_576,
  gib: 1_073_741_824,
});

function reportedBytes(details: string | undefined): number {
  const size = /^([\d.]+)\s*([A-Za-z]+)$/u.exec(
    details?.split(",")[0]?.trim() ?? "",
  );
  if (size === null) return 0;
  const value = Number.parseFloat(size[1] ?? "");
  const scale = UNIT_SCALES[(size[2] ?? "").toLowerCase()];
  if (!Number.isFinite(value) || scale === undefined) return 0;
  return Math.round(value * scale);
}

/** Last segment of a reported path, spelled with forward slashes. */
function baseName(path: string): string {
  const segments = path.split(/[/\\]/u).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

/**
 * Whether a reported name is a file. A produced document always carries its
 * extension, while a prose line that happens to start with a format word — a
 * summary the tool wrote, a translation of the status — does not. Reading the
 * one as the other would card a sentence.
 */
function isFileName(value: string): boolean {
  return /^[^./\\][^/\\]*\.[A-Za-z][A-Za-z0-9]{0,9}$/u.test(baseName(value));
}

/**
 * The files one tool result reports, in the order it reported them.
 *
 * `output` is the rendered text of the result, the same string the work group
 * shows. A tool that produced nothing — a read, an inspection, a refusal — is
 * not in the table and contributes no artifact.
 */
export function artifactsOfToolResult(
  toolName: string,
  output: string | null,
): readonly QaArtifactView[] {
  const formats = PRODUCED_FORMATS[toolName];
  if (formats === undefined || output === null) return [];
  const artifacts: QaArtifactView[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const reported = FILE_LINE.exec(line.trim());
    if (reported === null) continue;
    const format = reported[1] ?? "";
    const path = reported[2] ?? "";
    if (!formats.includes(format)) continue;
    if (path === "failed" || !isFileName(path) || isAbsolutePath(path))
      continue;
    artifacts.push({
      path,
      name: baseName(path),
      format,
      bytes: reportedBytes(reported[3]),
    });
  }
  return artifacts;
}
