import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

import { docxBytes, pdfBytes } from "./helpers/document-fixtures.js";

export let dir: string;
export let docxSrc: string;
export let pdfSrc: string;
export let logPath: string;
export let stubPandoc: string;
export let stubSoffice: string;

/** Stub backend: records its argv, then copies the fixture it was told to. */
export const STUB_SOURCE = `
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";

// A real backend decodes its command line in its own locale and its input
// files as UTF-8. Where no UTF-8 locale is set, every byte above 0x7F of an
// argument arrives as a replacement character, so the stub reads the metadata
// the same two ways: through argv (mangled) and through a file (intact).
const decodeArgv = (value) =>
  Array.from(Buffer.from(value, "utf8"), (byte) =>
    byte < 0x80 ? String.fromCharCode(byte) : "\\uFFFD",
  ).join("");
const readMetadata = (args) => {
  const meta = {};
  for (const arg of args) {
    if (!arg.startsWith("--metadata=")) continue;
    const pair = arg.slice("--metadata=".length);
    const eq = pair.indexOf("=");
    if (eq > 0) meta[pair.slice(0, eq)] = decodeArgv(pair.slice(eq + 1));
  }
  const file = args.find((arg) => arg.startsWith("--metadata-file="));
  if (file) {
    const scalar = (raw) => (raw.startsWith('"') ? JSON.parse(raw) : raw);
    for (const line of readFileSync(file.slice("--metadata-file=".length), "utf8").split("\\n")) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      meta[scalar(line.slice(0, colon).trim())] = scalar(line.slice(colon + 1).trim());
    }
  }
  return meta;
};
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};
/** A stored-entry ZIP: enough for a reader to open the part it carries. */
const storedZip = (entries) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const label = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(label.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(label.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, label, data);
    centrals.push(central, label);
    offset += local.length + label.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
};

const [docxSrc, pdfSrc, logPath, mode = "ok", ...argv] = process.argv.slice(2);
const record = () => {
  if (!logPath) return;
  appendFileSync(logPath, JSON.stringify({ argv, env: Object.keys(process.env), cwd: process.cwd() }) + "\\n");
};
record();

if (argv.includes("--version")) {
  process.stdout.write(process.env.STUB_VERSION_TEXT || "stub-backend 9.9.9\\n");
  process.exit(0);
}
if (mode === "fail") {
  process.stderr.write("\\u001b[31mbackend failed\\u001b[0m while reading /tmp/qa-documents/job-1/secret.md\\n");
  process.exit(3);
}
if (mode.startsWith("sleep:")) {
  await new Promise((resolve) => setTimeout(resolve, Number(mode.slice(6))));
}
if (mode === "spam") {
  process.stdout.write("x".repeat(200000));
  process.exit(0);
}
const out = argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
  ?? argv.filter((arg) => !arg.startsWith("-")).at(-1);
const to = argv.find((arg) => arg.startsWith("--to="))?.slice("--to=".length);
const outdirIndex = argv.indexOf("--outdir");
const outdir = outdirIndex >= 0 ? argv[outdirIndex + 1] : undefined;
if (mode === "no-output") process.exit(0);
const source = to === "pdf" ? pdfSrc : docxSrc;
const target = outdir
  ? path.join(outdir, path.basename(argv.at(-1) ?? "out").replace(/\\.[^.]+$/, "") + ".pdf")
  : out;
if (mode === "locale-docx") {
  const title = readMetadata(argv).title ?? "";
  const document =
    "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\" standalone=\\"yes\\"?>\\n" +
    "<w:document xmlns:w=\\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\\"><w:body>" +
    "<w:p><w:pPr><w:pStyle w:val=\\"Title\\"/></w:pPr><w:r><w:t>" + title + "</w:t></w:r></w:p>" +
    "</w:body></w:document>";
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, storedZip([["word/document.xml", Buffer.from(document, "utf8")]]));
  process.stdout.write("converted\\n");
  process.exit(0);
}
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, readFileSync(source));
process.stdout.write("converted\\n");
`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qa-docs-providers-"));
  docxSrc = path.join(dir, "fixture.docx");
  pdfSrc = path.join(dir, "fixture.pdf");
  logPath = path.join(dir, "argv.log");
  stubPandoc = path.join(dir, "stub-pandoc.mjs");
  stubSoffice = path.join(dir, "stub-soffice.mjs");
  await writeFile(docxSrc, docxBytes({ headings: ["H"] }));
  await writeFile(pdfSrc, pdfBytes({ pages: 2 }));
  await writeFile(stubPandoc, STUB_SOURCE, "utf8");
  await writeFile(stubSoffice, STUB_SOURCE, "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

export function pandocOptions(mode = "ok") {
  return {
    executable: process.execPath,
    timeoutMs: 20_000,
    programPrefixArgs: [stubPandoc, docxSrc, pdfSrc, logPath, mode],
  };
}

export function sofficeOptions(mode = "ok") {
  return {
    executable: process.execPath,
    timeoutMs: 20_000,
    programPrefixArgs: [stubSoffice, docxSrc, pdfSrc, logPath, mode],
  };
}

export async function argvLog(): Promise<
  { argv: string[]; env: string[]; cwd: string }[]
> {
  const raw = await readFile(logPath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(
      (line) =>
        JSON.parse(line) as { argv: string[]; env: string[]; cwd: string },
    );
}
