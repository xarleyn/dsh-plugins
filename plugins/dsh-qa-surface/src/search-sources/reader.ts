import {
  createPublicKey,
  randomBytes,
  verify,
  type KeyObject,
} from "node:crypto";
import { readFileSync, constants } from "node:fs";
import { open, opendir, type FileHandle } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
  archivePort,
  archiveHost,
  boundedBody,
  segments,
  ticketPattern,
  type ArchiveOperation,
} from "./protocol.js";

const directoryFlags =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const limit = 64 * 1024;

/** Linux descriptor-relative traversal. Operator mounts are read-only and only
 * visible to this worker. No symlink component or special file is followed. */
export async function readArchive(
  root: string,
  op: ArchiveOperation,
  signal: AbortSignal,
) {
  if (
    !["list", "search", "link", "read"].includes(op.action) ||
    segments(op.directory).length !== 1 ||
    !Number.isSafeInteger(op.offset) ||
    op.offset < 0 ||
    typeof op.query !== "string" ||
    op.query.length > 256
  )
    throw new Error("Invalid source operation.");
  const path = segments(op.path);
  const listing = op.action === "list" || op.action === "search";
  if (!listing && !path.length) throw new Error("A file is required.");
  signal.throwIfAborted();
  let handle: FileHandle = await open(root, directoryFlags);
  try {
    const parts = [op.directory, ...path];
    for (const [i, part] of parts.entries()) {
      signal.throwIfAborted();
      const next = await open(
        "/proc/self/fd/" + handle.fd + "/" + part,
        listing || i + 1 < parts.length ? directoryFlags : fileFlags,
      );
      await handle.close();
      handle = next;
    }
    signal.throwIfAborted();
    if (listing) {
      const entries = [];
      let matched = 0;
      const query = op.query.toLowerCase();
      const dir = await opendir("/proc/self/fd/" + handle.fd);
      for await (const entry of dir) {
        signal.throwIfAborted();
        if (
          (!entry.isFile() && !entry.isDirectory()) ||
          (op.action === "search" && !entry.name.toLowerCase().includes(query))
        )
          continue;
        if (matched++ < op.offset) continue;
        if (entries.length === 100) return { entries, nextOffset: matched - 1 };
        entries.push({
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
        });
      }
      return { entries, nextOffset: null };
    }
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("A regular file is required.");
    if (op.action === "link") return { path: op.path };
    const data = Buffer.alloc(
      Math.min(limit, Math.max(0, stat.size - op.offset)),
    );
    const { bytesRead } = await handle.read(data, 0, data.length, op.offset);
    const bytes = data.subarray(0, bytesRead);
    if (bytes.includes(0)) throw new Error("Text file required.");
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const more = op.offset + bytesRead < stat.size;
    // Leave a partial UTF-8 sequence for the next page.
    const text = decoder.decode(bytes, { stream: more });
    return {
      text,
      nextOffset: more ? op.offset + Buffer.byteLength(text) : null,
    };
  } finally {
    await handle.close();
  }
}

export function archiveReader(
  authPort: number,
  issuer: KeyObject,
  read: (op: ArchiveOperation, signal: AbortSignal) => Promise<unknown>,
) {
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST" || !ticketPattern.test(req.url ?? "")) {
      res.writeHead(403).end();
      return;
    }
    const closed = new AbortController();
    res.once("close", () => closed.abort());
    const signal = AbortSignal.any([closed.signal, AbortSignal.timeout(15000)]);
    try {
      const challenge = randomBytes(32).toString("hex");
      const auth = await fetch(
        "http://" + archiveHost + ":" + authPort + req.url,
        {
          method: "POST",
          headers: { "X-Reader-Challenge": challenge },
          redirect: "error",
          signal,
        },
      );
      if (!auth.ok || !auth.body) {
        await auth.body?.cancel();
        res.writeHead(403).end();
        return;
      }
      const body = await boundedBody(auth.body, 16 * 1024);
      const signature = Buffer.from(
        auth.headers.get("X-Archive-Signature") ?? "",
        "base64",
      );
      if (
        !verify(
          null,
          Buffer.from([challenge, req.url, body].join("\n")),
          issuer,
          signature,
        )
      ) {
        res.writeHead(403).end();
        return;
      }
      const op = JSON.parse(body) as ArchiveOperation;
      signal.throwIfAborted();
      const result = await read(op, signal);
      signal.throwIfAborted();
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(result));
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.platform !== "linux")
    throw new Error("The archive reader requires Linux.");
  archiveReader(
    archivePort(process.env.QA_SOURCE_AUTH_PORT, 18792),
    createPublicKey(readFileSync("/run/secrets/source-issuer.pub")),
    (op, signal) => readArchive("/archive", op, signal),
  ).listen(archivePort(process.env.QA_SOURCE_READER_PORT, 18791), archiveHost);
}
