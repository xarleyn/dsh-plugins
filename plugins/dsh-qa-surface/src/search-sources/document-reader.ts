import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { extractDocx } from "@yadsh/dsh-documents/docx";

const MiB = 1024 * 1024;
const maxFileBytes = 16 * MiB;
const maxCacheBytes = 8 * MiB;
const maxCacheEntries = 32;
const maxResponseBytes = 48 * 1024;
const maxFragmentChars = 4000;
const maxPdfPages = 1000;

type Format = "doc" | "docx" | "pdf";
type Fragment = {
  location: string;
  text: string;
  status?: "needs_ocr";
};

function fragmentsAt(location: string, text: string): Fragment[] {
  const fragments: Fragment[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maxFragmentChars, text.length);
    if (/^[\uDC00-\uDFFF]$/u.test(text[end] ?? "")) end--;
    fragments.push({ location, text: text.slice(start, end) });
    start = end;
  }
  return fragments;
}

function docxFragments(bytes: Buffer): Fragment[] {
  const { nodes } = extractDocx({
    bytes,
    filename: "document.docx",
    inputPath: "",
    ignoreFormatting: true,
    maxNodes: 5000,
    maxUncompressedBytes: 8 * MiB,
  });
  return nodes.flatMap((node) => {
    if (node.part === "comment") return [];
    const section = node.path.at(-1)?.slice(0, 160) || node.part;
    const { table, paragraph } = node.source;
    if (node.table && table !== undefined) {
      return node.table.rows.flatMap((row) =>
        fragmentsAt(
          `${section}, table ${table}, row ${row.row + 1}`,
          row.rawText,
        ),
      );
    }
    return fragmentsAt(
      paragraph === undefined ? section : `${section}, block ${paragraph}`,
      node.rawText,
    );
  });
}

function extractText(
  command: string,
  args: string[],
  input: Buffer | number,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [typeof input === "number" ? input : "pipe", "pipe", "ignore"],
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      killSignal: "SIGKILL",
    });
    const chunks: Buffer[] = [];
    let length = 0;
    child.stdout!.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length <= 2 * MiB) chunks.push(chunk);
      else child.kill("SIGKILL");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 && length <= 2 * MiB)
        resolve(Buffer.concat(chunks).toString("utf8"));
      else
        reject(
          new Error("Text extraction failed or exceeded the output limit."),
        );
    });
    child.stdin?.on("error", () => {});
    if (Buffer.isBuffer(input)) child.stdin?.end(input);
  });
}

type Extract = (
  format: Format,
  bytes: Buffer,
  signal: AbortSignal,
  handle?: FileHandle,
) => Promise<Fragment[]>;

export async function extractArchiveDocument(
  format: Format,
  bytes: Buffer,
  signal: AbortSignal,
  handle?: FileHandle,
) {
  if (format === "docx") return docxFragments(bytes);
  if (format === "doc") {
    if (
      !handle ||
      !bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))
    )
      throw new Error("A binary Word document is required.");
    // catdoc spools a pipe to disk. Inherit the already authorized, seekable file instead.
    const text = await extractText(
      "catdoc",
      ["-w", "-d", "utf-8", "/proc/self/fd/0"],
      handle.fd,
      signal,
    );
    return text
      .trim()
      .split(/\n+/u)
      .flatMap((block, index) =>
        fragmentsAt(`Text block ${index + 1}`, block.trim()),
      );
  }
  const text = await extractText(
    "pdftotext",
    ["-enc", "UTF-8", "-layout", "-l", String(maxPdfPages + 1), "-", "-"],
    bytes,
    signal,
  );
  const pages = text.split("\f");
  if (pages.at(-1) === "") pages.pop();
  if (!pages.length || pages.length > maxPdfPages)
    throw new Error("Invalid PDF page count.");
  return pages.flatMap((page, index) => {
    const location = `Page ${index + 1}`;
    return page.trim()
      ? fragmentsAt(location, page.trim())
      : [{ location, text: "", status: "needs_ocr" as const }];
  });
}

/** Every read must open the file through the reader's authorized traversal.
 * Only extraction results for identical bytes are reused. */
export class ArchiveDocumentReader {
  private readonly entries = new Map<
    string,
    {
      fragments: Fragment[];
      size: number;
      expires: number;
      timer: NodeJS.Timeout;
    }
  >();
  private cacheBytes = 0;

  constructor(
    private readonly runExtract: Extract = extractArchiveDocument,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.cacheBytes -= entry.size;
    this.entries.delete(key);
  }

  private save(key: string, fragments: Fragment[]) {
    const size = Buffer.byteLength(JSON.stringify(fragments));
    if (size > maxCacheBytes) return;
    this.remove(key);
    while (
      this.cacheBytes + size > maxCacheBytes ||
      this.entries.size >= maxCacheEntries
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.remove(oldest.value);
    }
    this.cacheBytes += size;
    const expires = performance.now() + this.ttlMs;
    const timer = setTimeout(() => this.remove(key), this.ttlMs).unref();
    this.entries.set(key, { fragments, size, expires, timer });
  }

  async read(
    handle: FileHandle,
    before: Stats,
    format: Format,
    offset: number,
    signal: AbortSignal,
  ) {
    if (before.size > maxFileBytes) {
      return {
        status: "file_too_large",
        message: "The document exceeds the 16 MiB direct-read limit.",
      };
    }
    const bytes = Buffer.alloc(before.size);
    let position = 0;
    while (position < bytes.length) {
      signal.throwIfAborted();
      const read = await handle.read(
        bytes,
        position,
        bytes.length - position,
        position,
      );
      if (!read.bytesRead) break;
      position += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      position !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      return {
        status: "document_changed",
        message:
          "The document changed while it was being read. Retry the read.",
      };
    }
    signal.throwIfAborted();
    const version = createHash("sha256").update(bytes).digest("hex");
    const key = format + ":" + version;
    const cached = this.entries.get(key);
    if (cached && cached.expires > performance.now()) {
      cached.expires = performance.now() + this.ttlMs;
      cached.timer.refresh();
      this.entries.delete(key);
      this.entries.set(key, cached);
    } else if (cached) this.remove(key);
    let fragments = this.entries.get(key)?.fragments;
    if (!fragments) {
      try {
        fragments = await this.runExtract(format, bytes, signal, handle);
      } catch (error) {
        signal.throwIfAborted();
        if (
          format !== "docx" &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        )
          return {
            status: "document_reader_unavailable",
            message: `The archive reader needs ${format === "pdf" ? "Poppler pdftotext" : "catdoc"}.`,
          };
        return {
          status: "document_unreadable",
          message: "The document could not be parsed within the reader limits.",
        };
      }
      signal.throwIfAborted();
      if (format === "doc") {
        const current = await handle.stat();
        if (
          current.size !== after.size ||
          current.mtimeMs !== after.mtimeMs ||
          current.ctimeMs !== after.ctimeMs
        )
          return {
            status: "document_changed",
            message: "The document changed during extraction. Retry the read.",
          };
      }
      this.save(key, fragments);
    }
    if (offset > fragments.length) {
      return {
        status: "invalid_offset",
        message: "Start at offset 0 or use the last nextOffset.",
      };
    }
    const page: Fragment[] = [];
    let size = 0;
    for (const fragment of fragments.slice(offset)) {
      size += Buffer.byteLength(JSON.stringify(fragment)) + 1;
      if (size > maxResponseBytes) break;
      page.push(fragment);
    }
    return {
      format,
      sha256: version,
      fragments: page,
      nextOffset:
        offset + page.length < fragments.length ? offset + page.length : null,
      ...(page.some((fragment) => fragment.status === "needs_ocr")
        ? {
            message: "Pages without extractable text need a separate OCR pass.",
          }
        : {}),
    };
  }
}
