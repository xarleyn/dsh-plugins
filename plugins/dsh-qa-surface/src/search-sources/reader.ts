import {
  createPublicKey,
  randomBytes,
  verify,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { opendir } from "node:fs/promises";
import { openArchivePath } from "./archive-path.js";
import { browseInventory, unavailableEntry } from "./inventory.js";
import { inventoryPolicy } from "./inventory-policy.js";
import { createServer } from "node:http";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { ArchiveDocumentReader } from "./document-reader.js";
export {
  ArchiveDocumentReader,
  extractArchiveDocument,
} from "./document-reader.js";
import {
  archivePort,
  archiveHost,
  boundedBody,
  segments,
  ticketPattern,
  type ArchiveOperation,
} from "./protocol.js";

const limit = 64 * 1024;
const documents = new ArchiveDocumentReader();

/** Linux descriptor-relative traversal. Operator mounts are read-only and only
 * visible to this worker. No symlink component or special file is followed. */
export async function readArchive(
  root: string,
  op: ArchiveOperation,
  signal: AbortSignal,
  config = {
    policy: process.env.QA_ARCHIVE_POLICY,
    inventory: process.env.QA_ARCHIVE_INVENTORY,
  },
  documentReader = documents,
) {
  if (
    !["list", "search", "link", "read", "find", "tree"].includes(op.action) ||
    segments(op.directory).length !== 1 ||
    !Number.isSafeInteger(op.offset) ||
    op.offset < 0 ||
    typeof op.query !== "string" ||
    op.query.length > 256
  )
    throw new Error("Invalid source operation.");
  const path = segments(op.path);
  const browsing = op.action === "find" || op.action === "tree";
  const listing = browsing || op.action === "list" || op.action === "search";
  if (!listing && !path.length) throw new Error("A file is required.");
  signal.throwIfAborted();
  if (config.inventory && !config.policy)
    throw new Error("Missing archive exclusion policy.");
  const policy = config.policy ? inventoryPolicy(config.policy) : undefined;
  const handle = await openArchivePath(
    root,
    op.directory,
    op.path,
    listing ? "directory" : "file",
    signal,
    policy,
  );
  try {
    signal.throwIfAborted();
    if (browsing) {
      if (!policy || !config.inventory)
        throw new Error("Archive inventory unavailable.");
      return await browseInventory(root, op, signal, policy, config.inventory);
    }
    if (listing) {
      const entries = [];
      const candidates = [];
      const query = op.query.toLowerCase();
      const dir = await opendir("/proc/self/fd/" + handle.fd);
      for await (const entry of dir) {
        signal.throwIfAborted();
        if (
          (!entry.isFile() && !entry.isDirectory()) ||
          (policy &&
            !policy.permits(
              entry.name,
              entry.isDirectory() ? "directory" : "file",
            )) ||
          (op.action === "search" && !entry.name.toLowerCase().includes(query))
        )
          continue;
        candidates.push({
          name: entry.name,
          kind: entry.isDirectory()
            ? ("directory" as const)
            : ("file" as const),
        });
      }
      candidates.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      let cursor = op.offset;
      while (cursor < candidates.length && entries.length < 100) {
        signal.throwIfAborted();
        const entry = candidates[cursor++]!;
        if (policy) {
          const child = [...path, entry.name].join("/");
          try {
            segments(child);
          } catch {
            continue;
          }
          try {
            const live = await openArchivePath(
              root,
              op.directory,
              child,
              entry.kind,
              signal,
              policy,
            );
            try {
              const s = await live.stat();
              if (entry.kind === "file" ? !s.isFile() : !s.isDirectory())
                continue;
            } finally {
              await live.close();
            }
          } catch (error) {
            if (unavailableEntry(error)) continue;
            throw error;
          }
        }
        entries.push(entry);
      }
      return {
        entries,
        nextOffset: cursor < candidates.length ? cursor : null,
      };
    }
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("A regular file is required.");
    if (op.action === "link") return { path: op.path };
    const format = extname(op.path).slice(1).toLowerCase();
    if (format === "doc" || format === "docx" || format === "pdf") {
      return await documentReader.read(handle, stat, format, op.offset, signal);
    }
    if (format === "docm")
      return {
        status: "unsupported_format",
        message: "Choose a DOCX copy of this macro-enabled Word document.",
      };
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
