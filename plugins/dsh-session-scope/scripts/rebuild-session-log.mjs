// Rebuild one session's durable log from the live server's in-memory state.
//
// Why: if a session's .jsonl.zstd file is deleted (or corrupted) under a live
// server, the coordinator only appends new events — the durable file can end
// up missing the header invariant ("first frame is not exactly one header
// line") and, worse, missing most of the log. The server still holds the
// complete log in memory; this script pages it out through the session.history
// RPC and writes a fresh, valid artifact (header frame + event frames,
// checksummed, atomically renamed into place).
//
// Run with: node wss-rebuild-session.mjs <baseUrl> <sessionId>
// (Node 24; uses global fetch + node:zlib zstd)

import { readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { zstdCompressSync, zstdDecompressSync, constants } from "node:zlib";

const [baseUrl, sessionId] = process.argv.slice(2);
if (!baseUrl || !sessionId) {
  console.error("usage: node wss-rebuild-session.mjs <baseUrl> <sessionId>");
  process.exit(2);
}

let rpcSeq = 0;
async function unary(method, payload) {
  const body = { type: "client-request", rpcId: `rebuild-${++rpcSeq}`, method, payload };
  const res = await fetch(`${baseUrl}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.result === undefined || data.result.ok !== true) {
    throw new Error(`${method} failed: ${JSON.stringify(data.result ?? data).slice(0, 300)}`);
  }
  return data.result.value;
}

// 1. Page the full event log from the live session (memory, not the disk file).
const events = [];
const bySeq = new Map();
let beforeSeq;
let pages = 0;
for (;;) {
  const value = await unary("session.history", {
    sessionId,
    ...(beforeSeq === undefined ? {} : { beforeSeq }),
    maxMessages: 2000,
  });
  pages += 1;
  const page = value.events;
  if (page.length === 0) break;
  let minSeq = Infinity;
  for (const entry of page) {
    const event = entry.event;
    if (event === undefined || typeof event.seq !== "number") continue;
    if (bySeq.has(event.seq)) continue;
    bySeq.set(event.seq, event);
    events.push(event);
    if (event.seq < minSeq) minSeq = event.seq;
  }
  if (value.hasMore !== true || minSeq === Infinity) break;
  beforeSeq = minSeq - 1;
  if (pages > 400) throw new Error("paging did not converge");
}
events.sort((a, b) => a.seq - b.seq);
console.log(`dumped ${events.length} events in ${pages} pages, seq ${events[0]?.seq}..${events.at(-1)?.seq}`);

// Contiguity check on the dump itself.
for (let i = 1; i < events.length; i++) {
  if (events[i].seq !== events[i - 1].seq + 1) {
    throw new Error(`dump has a seq gap at ${events[i - 1].seq} -> ${events[i].seq}`);
  }
}

// 2. Build the artifact: header frame (exactly one line) + event frames.
// The history API does not carry the header; the caller supplies it via the
// WSS_HEADER environment variable (JSON, single line — e.g. the first line
// of the old artifact's first frame).
const rawHeader = process.env.WSS_HEADER;
if (!rawHeader) throw new Error("WSS_HEADER environment variable with the session header JSON is required");
const parsedHeader = JSON.parse(rawHeader);
if (parsedHeader.id !== sessionId) throw new Error(`WSS_HEADER id ${parsedHeader.id} does not match ${sessionId}`);
const headerLine = JSON.stringify(parsedHeader) + "\n";
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const frame = (text) => zstdCompressSync(Buffer.from(text, "utf8"), CHECKSUM_OPTIONS);

const FRAME_EVENTS = 2000;
const parts = [frame(headerLine)];
for (let i = 0; i < events.length; i += FRAME_EVENTS) {
  const slice = events.slice(i, i + FRAME_EVENTS);
  parts.push(frame(slice.map((e) => JSON.stringify(e)).join("\n") + "\n"));
}
const content = Buffer.concat(parts);
console.log(`artifact ${content.length} bytes, ${parts.length} frames`);

// 4. Verify the published artifact the same way the harness reader does.
const ZSTD_MAGIC = 4247762216;
function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, error: `bad magic at ${offset}`, tornStart: start };
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) return { frames, error: "reserved block type" };
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}
function verify(path) {
  const published = readFileSync(path);
  const { frames, error, tornStart } = scanFrames(published);
  if (error !== undefined || tornStart !== undefined) throw new Error(`published artifact invalid: ${error ?? "torn tail"}`);
  const firstPlain = zstdDecompressSync(published.subarray(frames[0].start, frames[0].end)).toString("utf8");
  if (firstPlain.length === 0 || firstPlain.indexOf("\n") !== firstPlain.length - 1) {
    throw new Error("published artifact: first frame is not exactly one header line");
  }
  let seqs = [];
  for (const fr of frames) {
    const plain = zstdDecompressSync(published.subarray(fr.start, fr.end)).toString("utf8");
    for (const line of plain.split("\n")) {
      if (line.length === 0) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && typeof rec.seq === "number") seqs.push(rec.seq);
      } catch {
        /* header frame line */
      }
    }
  }
  seqs.sort((a, b) => a - b);
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] !== seqs[i - 1] + 1) throw new Error(`published artifact has a seq gap at ${seqs[i - 1]} -> ${seqs[i]}`);
  }
  console.log(`verified: ${frames.length} frames, ${seqs.length} events, header OK, contiguous 0..${seqs.at(-1)}`);
  return { frames, seqs };
}
// 3. Publish atomically (0600 like the writer's files). Dry-run mode only
// verifies the temp artifact without replacing the live file.
const sessionDir = process.env.WSS_SESSION_DIR;
if (!sessionDir) throw new Error("WSS_SESSION_DIR environment variable is required");
mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
const finalPath = join(sessionDir, "session.jsonl.zstd");
const tmp = `${finalPath}.rebuild-${process.pid}.tmp`;
writeFileSync(tmp, content, { mode: 0o600 });
chmodSync(tmp, 0o600);
if (process.env.WSS_DRY_RUN === "1") {
  console.log("dry run: artifact staged at", tmp);
  await verify(tmp);
  console.log("dry run: staged artifact verified OK (not published)");
  process.exit(0);
}
renameSync(tmp, finalPath);
console.log("published", finalPath);

