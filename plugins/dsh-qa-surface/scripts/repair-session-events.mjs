#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  constants as fsConstants,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  constants as zlibConstants,
  zstdCompressSync,
  zstdDecompressSync,
} from "node:zlib";

export const REPAIRABLE_EVENT_TYPES = new Set([
  "safety-gate/check",
  "safety-gate/block",
  "safety-gate/warn",
  "safety-gate/classifier-error",
  "qa/sources",
]);

const ZSTD_MAGIC = 0xfd2fb528;
const CHECKSUM_OPTIONS = {
  params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 },
};

/** Locate complete frames in a concatenated Zstandard artifact. */
export function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 5) throw new Error(`torn frame at ${start}`);
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`bad Zstandard magic at ${offset}`);
    }
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes =
      contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const headerBytes =
      (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < headerBytes) {
      throw new Error(`torn frame header at ${start}`);
    }
    offset += headerBytes;
    for (;;) {
      if (buffer.length - offset < 3) {
        throw new Error(`torn block header at ${start}`);
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved block type at ${start}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        throw new Error(`torn block payload at ${start}`);
      }
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) {
        throw new Error(`torn checksum at ${start}`);
      }
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

function decodeArtifact(filePath, content) {
  if (!filePath.endsWith(".zstd")) return content.toString("utf8");
  return scanZstdFrames(content)
    .map(({ start, end }) =>
      zstdDecompressSync(content.subarray(start, end)).toString("utf8"),
    )
    .join("");
}

function encodeArtifact(filePath, rows) {
  const text = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  if (!filePath.endsWith(".zstd")) return Buffer.from(text, "utf8");
  // Harness requires the first frame to contain exactly the header line.
  const frames = [
    zstdCompressSync(
      Buffer.from(`${JSON.stringify(rows[0])}\n`, "utf8"),
      CHECKSUM_OPTIONS,
    ),
  ];
  const eventRows = rows.slice(1);
  const frameSize = 2_000;
  for (let index = 0; index < eventRows.length; index += frameSize) {
    const plain = `${eventRows
      .slice(index, index + frameSize)
      .map((row) => JSON.stringify(row))
      .join("\n")}\n`;
    frames.push(zstdCompressSync(Buffer.from(plain, "utf8"), CHECKSUM_OPTIONS));
  }
  return Buffer.concat(frames);
}

function parseRows(filePath, plain) {
  const lines = plain.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error(`${filePath}: empty session log`);
  return lines.map((line, index) => {
    try {
      const row = JSON.parse(line);
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        throw new Error("row is not an object");
      }
      return row;
    } catch (error) {
      throw new Error(`${filePath}: invalid JSON on row ${index + 1}`, {
        cause: error,
      });
    }
  });
}

/** Repair one offline session log; dry-run is the default. */
export function repairSessionFile(filePath, options = {}) {
  const write = options.write === true;
  const before = statSync(filePath);
  const original = readFileSync(filePath);
  const rows = parseRows(filePath, decodeArtifact(filePath, original));
  let changed = 0;
  const types = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!REPAIRABLE_EVENT_TYPES.has(row.type) || row.ignorable === true)
      continue;
    row.ignorable = true;
    changed += 1;
    types.set(row.type, (types.get(row.type) ?? 0) + 1);
  }
  if (changed === 0 || !write) {
    return {
      filePath,
      changed,
      types: Object.fromEntries(types),
      written: false,
    };
  }

  const now = statSync(filePath);
  if (now.size !== before.size || now.mtimeMs !== before.mtimeMs) {
    throw new Error(
      `${filePath}: changed while being inspected; stop DSH and retry`,
    );
  }
  const backup = `${filePath}.pre-plugin-event-repair.bak`;
  copyFileSync(filePath, backup, fsConstants.COPYFILE_EXCL);
  const repaired = encodeArtifact(filePath, rows);
  // Decode before publishing so a bad generated frame cannot replace the log.
  parseRows(filePath, decodeArtifact(filePath, repaired));
  const temp = `${filePath}.${process.pid}.repair.tmp`;
  writeFileSync(temp, repaired, { mode: before.mode });
  chmodSync(temp, before.mode);
  renameSync(temp, filePath);
  return {
    filePath,
    changed,
    types: Object.fromEntries(types),
    written: true,
    backup,
  };
}

function sessionFiles(target) {
  const details = lstatSync(target);
  if (details.isSymbolicLink()) return [];
  if (details.isFile()) {
    return target.endsWith(".jsonl") || target.endsWith(".jsonl.zstd")
      ? [target]
      : [];
  }
  if (!details.isDirectory()) return [];
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    return sessionFiles(path.join(target, entry.name));
  });
}

function usage() {
  return `Usage: qa-repair-sessions [--write] [session-file-or-directory ...]

Dry-run is the default. With no target, scans $DSH_HOME/sessions (or
~/.dsh/sessions when DSH_HOME is unset). Stop DSH before using --write.

The command only adds ignorable:true to legacy safety-gate/* and qa/sources
events. Before each changed file is replaced atomically, an exclusive
*.pre-plugin-event-repair.bak backup is created.`;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }
  const write = argv.includes("--write");
  const unknown = argv.filter(
    (arg) => arg.startsWith("-") && arg !== "--write",
  );
  if (unknown.length > 0) throw new Error(`unknown option: ${unknown[0]}`);
  const targets = argv.filter((arg) => !arg.startsWith("-"));
  if (targets.length === 0) {
    const home =
      process.env.DSH_HOME?.trim() || path.join(os.homedir(), ".dsh");
    targets.push(path.join(home, "sessions"));
  }
  if (write) console.error("write mode: DSH must be stopped");
  const files = [...new Set(targets.flatMap(sessionFiles))].sort();
  let candidates = 0;
  let events = 0;
  for (const file of files) {
    const result = repairSessionFile(file, { write });
    if (result.changed === 0) continue;
    candidates += 1;
    events += result.changed;
    console.log(
      `${result.written ? "repaired" : "would repair"}: ${file} (${result.changed} events)`,
    );
    if (result.backup !== undefined) console.log(`backup: ${result.backup}`);
  }
  console.log(
    `${write ? "repaired" : "dry run"}: ${events} events in ${candidates} of ${files.length} session logs`,
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
