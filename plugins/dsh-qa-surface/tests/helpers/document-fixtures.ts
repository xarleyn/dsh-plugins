/**
 * Fixture builders for the document tests.
 *
 * The tests need real containers, not stubs of them: a DOCX that the ZIP
 * reader can actually open, a PDF whose page count and document information
 * entries are really in the file, and an encrypted variant. Building them here
 * keeps binary fixtures out of the repository and keeps the assertions honest —
 * `document_inspect` is exercised against files a writer would accept.
 */

import { deflateRawSync } from "node:zlib";

/** Standard CRC-32 (IEEE 802.3), as ZIP entries require. */
export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  readonly name: string;
  readonly data: string | Buffer;
  /** Store instead of deflate (used to cover the uncompressed path). */
  readonly store?: boolean;
}

/** Build a ZIP archive with correct CRC-32 and offsets. */
export function buildZip(entries: readonly ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw =
      typeof entry.data === "string"
        ? Buffer.from(entry.data, "utf8")
        : entry.data;
    const method = entry.store === true ? 0 : 8;
    const payload = method === 0 ? raw : deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

export interface DocxFixtureOptions {
  readonly title?: string;
  readonly author?: string;
  readonly createdAt?: string;
  readonly modifiedAt?: string;
  readonly headings?: readonly string[];
  readonly paragraphs?: readonly string[];
  readonly tables?: number;
  readonly images?: number;
  /** Adds `word/vbaProject.bin` and a macro-enabled content type. */
  readonly macroEnabled?: boolean;
}

const CONTENT_TYPES = (macro: boolean): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="${
    macro
      ? "application/vnd.ms-word.document.macroEnabled.main+xml"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
  }"/>
${macro ? '<Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>' : ""}
</Types>`;

/** A minimal but genuinely valid DOCX package. */
export function docxBytes(options: DocxFixtureOptions = {}): Buffer {
  const paragraphs = [
    ...(options.headings ?? []).map(
      (heading, index) =>
        `<w:p><w:pPr><w:pStyle w:val="Heading${Math.min(index + 1, 6)}"/></w:pPr><w:r><w:t>${heading}</w:t></w:r></w:p>`,
    ),
    ...(options.paragraphs ?? []).map(
      (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
    ),
    ...Array.from(
      { length: options.tables ?? 0 },
      () =>
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    ),
    ...Array.from(
      { length: options.images ?? 0 },
      () => "<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>",
    ),
  ].join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
${options.title === undefined ? "" : `<dc:title>${options.title}</dc:title>`}
${options.author === undefined ? "" : `<dc:creator>${options.author}</dc:creator>`}
${options.createdAt === undefined ? "" : `<dcterms:created>${options.createdAt}</dcterms:created>`}
${options.modifiedAt === undefined ? "" : `<dcterms:modified>${options.modifiedAt}</dcterms:modified>`}
</cp:coreProperties>`;
  const entries: ZipEntryInput[] = [
    {
      name: "[Content_Types].xml",
      data: CONTENT_TYPES(options.macroEnabled === true),
    },
    { name: "_rels/.rels", data: "<Relationships/>" },
    { name: "word/document.xml", data: document },
    { name: "docProps/core.xml", data: core },
  ];
  if ((options.images ?? 0) > 0) {
    entries.push({
      name: "word/media/image1.png",
      // Stored, not deflated: covers the uncompressed ZIP path too.
      store: true,
      data: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
      ]),
    });
  }
  if (options.macroEnabled === true) {
    entries.push({
      name: "word/vbaProject.bin",
      data: Buffer.from("macro", "utf8"),
    });
  }
  return buildZip(entries);
}

export interface PdfFixtureOptions {
  readonly pages?: number;
  readonly encrypted?: boolean;
  readonly title?: string;
  readonly author?: string;
  readonly images?: number;
  readonly text?: string;
}

/** A small PDF with a correct cross-reference table. */
export function pdfBytes(options: PdfFixtureOptions = {}): Buffer {
  const pages = options.pages ?? 1;
  const images = options.images ?? 0;
  const text = options.text ?? "Document pipeline fixture";
  const objects: string[] = [];
  const kids = Array.from(
    { length: pages },
    (_value, index) => `${3 + index} 0 R`,
  ).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  const pageIds: number[] = [];
  for (let index = 0; index < pages; index += 1) pageIds.push(3 + index);
  const contentIds = pageIds.map((id) => id + pages);
  for (let index = 0; index < pages; index += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${3 + pages * 2} 0 R >> >> >>`,
    );
  }
  for (let index = 0; index < pages; index += 1) {
    const stream = `BT /F1 14 Tf 72 760 Td (${text} page ${index + 1}) Tj ET`;
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let index = 0; index < images; index += 1) {
    objects.push(
      "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\u0000\nendstream",
    );
  }
  const infoId = objects.length + 1;
  objects.push(
    `<< ${options.title === undefined ? "" : `/Title (${options.title}) `}${
      options.author === undefined ? "" : `/Author (${options.author}) `
    }/CreationDate (D:20260914120000Z) /ModDate (D:20260914123000Z) >>`,
  );

  const header = "%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n";
  let body = header;
  const offsets: number[] = [];
  objects.forEach((content, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });
  const xrefOffset = body.length;
  const total = objects.length + 1;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoId} 0 R${
    options.encrypted === true ? " /Encrypt 99 0 R" : ""
  } >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}

/** Plain-text document used as a Markdown input. */
export function markdownFixture(): string {
  return [
    "---",
    "title: Отчёт по прогону",
    "author: QA",
    "---",
    "",
    "# Отчёт",
    "",
    "## Итоги",
    "",
    "Все проверки пройдены.",
    "",
    "| Проверка | Статус |",
    "| --- | --- |",
    "| Вход | ok |",
    "",
    "```ts",
    "const answer = 42;",
    "```",
    "",
    ":::pagebreak",
    ":::",
    "",
    "## Приложение",
    "",
    "![Скриншот](assets/shot.png)",
    "",
  ].join("\n");
}

/** A 1×1 PNG, sufficient for asset validation tests. */
export function pngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
}

export function pngDataUri(): string {
  return `data:image/png;base64,${pngBytes().toString("base64")}`;
}
