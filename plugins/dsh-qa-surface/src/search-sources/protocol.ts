import type { IncomingMessage } from "node:http";

export type ArchiveAction =
  "list" | "search" | "read" | "link" | "find" | "tree";
export interface ArchiveOperation {
  readonly directory: string;
  readonly action: ArchiveAction;
  readonly path: string;
  readonly query: string;
  readonly offset: number;
  readonly depth?: number;
  readonly kind?: "directory" | "file";
  readonly snapshot?: string;
}

export function archivePort(
  value: string | undefined,
  fallback: number,
): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid archive port.");
  return port;
}
export const archiveHost = "127.0.0.1";
export const ticketPattern = /^\/[a-f0-9]{64}$/u;

export function segments(path: string): string[] {
  if (typeof path !== "string" || path.length > 2048)
    throw new Error("Invalid relative path.");
  if (!path) return [];
  const parts = path.split("/");
  if (
    parts.some((p) => !p || p === "." || p === ".." || /[\\:\p{Cc}]/u.test(p))
  )
    throw new Error("Invalid relative path.");
  return parts;
}
export async function boundedBody(
  input: IncomingMessage | ReadableStream<Uint8Array>,
  limit: number,
) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const part of input) {
    const chunk = Buffer.from(part);
    bytes += chunk.length;
    if (bytes > limit)
      throw new Error("Archive response exceeds the size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
