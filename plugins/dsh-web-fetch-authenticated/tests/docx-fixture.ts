/**
 * A real (if tiny) DOCX archive for the extraction tests: a ZIP written by
 * hand, with correct CRCs and deflated entries, so the reader is exercised the
 * way a Word file exercises it — central directory, local headers, inflate.
 */

import { deflateRawSync } from "node:zlib";

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipInput {
  readonly name: string;
  readonly content: string;
}

/** Build a ZIP archive in memory from text entries. */
export function buildZip(entries: readonly ZipInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const raw = encoder.encode(entry.content);
    const deflated = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = new Uint8Array(30 + nameBytes.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, deflated.byteLength, true);
    localView.setUint32(22, raw.byteLength, true);
    localView.setUint16(26, nameBytes.byteLength, true);
    local.set(nameBytes, 30);
    parts.push(local, new Uint8Array(deflated));

    const entryBytes = new Uint8Array(46 + nameBytes.byteLength);
    const entryView = new DataView(entryBytes.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true);
    entryView.setUint16(6, 20, true);
    entryView.setUint16(10, 8, true);
    entryView.setUint32(16, crc, true);
    entryView.setUint32(20, deflated.byteLength, true);
    entryView.setUint32(24, raw.byteLength, true);
    entryView.setUint16(28, nameBytes.byteLength, true);
    entryView.setUint32(42, offset, true);
    entryBytes.set(nameBytes, 46);
    central.push(entryBytes);

    offset += local.byteLength + deflated.byteLength;
  }

  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.byteLength, true);
  endView.setUint32(16, offset, true);
  return concat([...parts, centralBytes, end]);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** A DOCX whose body exercises paragraphs, headings, lists, tables and fields. */
export function buildDocx(bodyXml: string): Uint8Array {
  return buildZip([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    },
    {
      name: "word/document.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${bodyXml}</w:body></w:document>`,
    },
  ]);
}

/** An ODT whose body exercises headings, paragraphs and a table. */
export function buildOdt(bodyXml: string): Uint8Array {
  return buildZip([
    {
      name: "mimetype",
      content: "application/vnd.oasis.opendocument.text",
    },
    {
      name: "content.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
        ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"' +
        ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">' +
        `<office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`,
    },
  ]);
}
