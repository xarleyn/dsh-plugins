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
