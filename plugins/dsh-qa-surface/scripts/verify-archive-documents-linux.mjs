import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import {
  ArchiveDocumentReader,
  archiveReader,
  extractArchiveDocument,
  readArchive,
} from "../lib/search-sources/reader.js";
import { ArchiveGateway } from "../lib/search-sources/gateway.js";

// PDF with text on the first and third pages and only a raster on the second.
// The sheet's both text values, image and page order are fixed by this fixture.
function samplePdf(value = "85.5 L/min") {
  const stream = (content, dictionary = "") =>
    `<< /Length ${Buffer.byteLength(content, "latin1")} ${dictionary} >>\nstream\n${content}\nendstream`;
  const page = (contents) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]
    /Resources << /Font << /F1 9 0 R >> /XObject << /Im1 10 0 R >> >>
    /Contents ${contents} 0 R >>`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>",
    page(6),
    page(7),
    page(8),
    stream(`BT /F1 14 Tf 10 100 Td (${value}) Tj ET`),
    stream("q 120 0 0 100 10 10 cm /Im1 Do Q"),
    stream("BT /F1 14 Tf 10 100 Td (Verification) Tj ET"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream(
      "\x00",
      "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8",
    ),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${offsets.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("selected document reads preserve locations, editions and authorization", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qa-document-read-"));
  const docs = join(root, "docs");
  const word = await readFile(
    new URL("../tests/fixtures/archive/equipment.docx", import.meta.url),
  );
  const legacy = await readFile(
    new URL("../tests/fixtures/archive/equipment.doc", import.meta.url),
  );
  const pdf = samplePdf();
  const files = {
    "equipment.docx": word,
    "report.pdf": pdf,
    "legacy.doc": legacy,
    "invalid.doc": Buffer.from("not a Word file"),
  };
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(docs);
  for (const [name, bytes] of Object.entries(files))
    await writeFile(join(docs, name), bytes);
  const policy = join(root, "policy.json");
  const rules = {
    directories: [],
    files: [],
    sensitiveNames: [],
    excludedExtensions: [],
    allowedExtensions: [".doc", ".docx", ".pdf"],
  };
  await writeFile(policy, JSON.stringify(rules));
  const calls = { docx: 0, doc: 0, pdf: 0 };
  const documents = new ArchiveDocumentReader(
    (format, bytes, signal, handle) => {
      calls[format]++;
      return extractArchiveDocument(format, bytes, signal, handle);
    },
    1000,
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const reservation = createServer();
  const authPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const reader = archiveReader(authPort, publicKey, (op, signal) =>
    readArchive(root, op, signal, { policy, inventory: undefined }, documents),
  );
  const readerPort = await listen(reader);
  const gateway = new ArchiveGateway(readerPort, authPort, privateKey);
  t.after(() => {
    gateway.dispose();
    reader.closeAllConnections();
    reader.close();
  });
  let allowed = true;
  const check = async () => assert.ok(allowed, "revoked");
  const run = (path, offset = 0) =>
    gateway.perform(
      { action: "read", directory: "docs", query: "", path, offset },
      check,
      globalThis.AbortSignal.timeout(5000),
    );
  const measure = async (path) => {
    const firstStart = performance.now();
    const first = await run(path);
    const firstMs = performance.now() - firstStart;
    const repeatStart = performance.now();
    assert.deepEqual(await run(path), first);
    const repeatMs = performance.now() - repeatStart;
    t.diagnostic(
      `${path} (${files[path].length} bytes): first ${firstMs.toFixed(2)} ms, repeat ${repeatMs.toFixed(2)} ms, extractor calls ${calls[first.format]}`,
    );
    return first;
  };

  const wordResult = await measure("equipment.docx");
  assert.equal(wordResult.sha256, digest(word));
  assert.ok(
    wordResult.fragments.some(
      ({ text, location }) =>
        text === "Pressure | 47.25 kPa" &&
        location === "Equipment, table 1, row 1",
    ),
  );
  const pdfResult = await measure("report.pdf");
  assert.deepEqual(pdfResult.fragments, [
    { text: "85.5 L/min", location: "Page 1" },
    { text: "", location: "Page 2", status: "needs_ocr" },
    { text: "Verification", location: "Page 3" },
  ]);
  assert.match(pdfResult.message, /separate OCR pass/u);
  const legacyResult = await measure("legacy.doc");
  assert.equal(legacyResult.sha256, digest(legacy));
  assert.ok(
    legacyResult.fragments.some(
      (f) => f.text === "Flow 32.75 L/min" && f.location === "Text block 2",
    ),
  );
  assert.deepEqual(calls, { docx: 1, doc: 1, pdf: 1 });
  assert.equal((await run("invalid.doc")).status, "document_unreadable");
  assert.equal((await run("report.pdf", 100)).status, "invalid_offset");

  allowed = false;
  await assert.rejects(run("report.pdf"), /revoked/u);
  assert.equal(calls.pdf, 1);
  allowed = true;
  await writeFile(policy, JSON.stringify({ ...rules, files: ["report.pdf"] }));
  await assert.rejects(run("report.pdf"));
  assert.equal(calls.pdf, 1);
  await writeFile(policy, JSON.stringify(rules));
  const replacement = samplePdf("12.5 L/min");
  assert.equal(replacement.length, pdf.length);
  const originalTime = await stat(join(docs, "report.pdf"));
  await writeFile(join(docs, "report.pdf"), replacement);
  await utimes(
    join(docs, "report.pdf"),
    originalTime.atime,
    originalTime.mtime,
  );
  const updated = await run("report.pdf");
  assert.equal(updated.sha256, digest(replacement));
  assert.equal(updated.fragments[0].text, "12.5 L/min");
  assert.equal(calls.pdf, 2);
  await setTimeout(1100);
  assert.deepEqual(await run("report.pdf"), updated);
  assert.equal(calls.pdf, 3);
  assert.deepEqual((await readdir(docs)).sort(), Object.keys(files).sort());
  assert.equal(
    digest(await readFile(join(docs, "equipment.docx"))),
    digest(word),
  );
});
