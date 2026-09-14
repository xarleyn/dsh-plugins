import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  repairSessionFile,
  scanZstdFrames,
} from "../scripts/repair-session-events.mjs";

const checksum = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const header = { id: "session-1", version: 1 };
const standard = { type: "turn/start", seq: 0, data: { turn: 1 } };
const custom = {
  type: "safety-gate/warn",
  seq: 1,
  data: { decision: "warn" },
};

function rows(file) {
  const content = readFileSync(file);
  const plain = file.endsWith(".zstd")
    ? scanZstdFrames(content)
        .map(({ start, end }) =>
          zstdDecompressSync(content.subarray(start, end)).toString("utf8"),
        )
        .join("")
    : content.toString("utf8");
  return plain
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("qa-repair-sessions", () => {
  it("keeps dry-run read-only and marks only plugin events", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-repair-plain-"));
    const file = path.join(dir, "session.jsonl");
    const original = `${[header, standard, custom].map(JSON.stringify).join("\n")}\n`;
    writeFileSync(file, original, "utf8");

    expect(repairSessionFile(file)).toMatchObject({
      changed: 1,
      written: false,
    });
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(repairSessionFile(file, { write: true })).toMatchObject({
      changed: 1,
      written: true,
      types: { "safety-gate/warn": 1 },
    });
    expect(rows(file)).toEqual([
      header,
      standard,
      { ...custom, ignorable: true },
    ]);
    expect(readFileSync(`${file}.pre-plugin-event-repair.bak`, "utf8")).toBe(
      original,
    );
  });

  it("repairs concatenated Zstandard frames and preserves the header frame", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-repair-zstd-"));
    const file = path.join(dir, "session.jsonl.zstd");
    const original = Buffer.concat([
      zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`), checksum),
      zstdCompressSync(
        Buffer.from(`${JSON.stringify(standard)}\n${JSON.stringify(custom)}\n`),
        checksum,
      ),
    ]);
    writeFileSync(file, original);

    expect(repairSessionFile(file, { write: true })).toMatchObject({
      changed: 1,
      written: true,
    });
    const repaired = readFileSync(file);
    const frames = scanZstdFrames(repaired);
    expect(frames).toHaveLength(2);
    expect(
      zstdDecompressSync(
        repaired.subarray(frames[0].start, frames[0].end),
      ).toString("utf8"),
    ).toBe(`${JSON.stringify(header)}\n`);
    expect(rows(file).at(-1)).toEqual({ ...custom, ignorable: true });
    expect(readFileSync(`${file}.pre-plugin-event-repair.bak`)).toEqual(
      original,
    );
  });
});
