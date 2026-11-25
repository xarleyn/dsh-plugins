/**
 * `dsh_cas_retrieve` — bounded windowed access to a stored object (SPEC §20).
 *
 * The chunk bounds are enforced at this boundary: the tool never returns more
 * than the configured retrieval maximum regardless of what the model asks
 * for (SPEC AC6).
 */

import { Buffer } from "node:buffer";

import { defineTool } from "@deepseek-ai/dsh-tools";

import { CasError } from "../cas/errors.js";
import type { CasStore } from "../cas/types.js";
import type { ResolvedCasResultsConfig } from "../config.js";
import { CasCounters } from "../observability/counters.js";
import {
  missingObjectMessage,
  readOptionalInteger,
  readOptionalString,
  readRefArg,
} from "./refs.js";

const ENCODINGS = ["auto", "utf8", "base64", "hex"] as const;
type Encoding = (typeof ENCODINGS)[number];

export interface RetrieveDeps {
  readonly store: CasStore;
  readonly counters: CasCounters;
  readonly readConfig: () => ResolvedCasResultsConfig;
}

export function createRetrieveTool(deps: RetrieveDeps) {
  const { store, counters, readConfig } = deps;
  return defineTool({
    name: "dsh_cas_retrieve",
    description: [
      "Retrieve a bounded portion of a tool result previously offloaded by dsh-cas-results.",
      "Use the sha256 reference from an offload marker.",
      "Large objects are paginated: read more with offset when truncated.",
    ].join(" "),
    parameters: {
      ref: {
        type: "string",
        required: true,
        description:
          'Content reference from the offload marker, e.g. "sha256:ab12...".',
      },
      offset: {
        type: "integer",
        description:
          "Byte offset to start reading from. For text, use the previous offset plus returnedBytes to start on a character boundary.",
      },
      limit: {
        type: "integer",
        description:
          "Maximum bytes to return. Default and hard maximum come from the plugin configuration.",
      },
      encoding: {
        type: "string",
        enum: [...ENCODINGS],
        description:
          'Response encoding. "auto" uses utf8 for text and base64 for binary payloads.',
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref: { type: "string", required: true },
          kind: { type: "string", required: true },
          mediaType: { type: "string", required: true },
          encoding: { type: "string", required: true },
          totalBytes: { type: "integer", required: true },
          offset: { type: "integer", required: true },
          returnedBytes: { type: "integer", required: true },
          truncated: { type: "boolean", required: true },
          content: { type: "string", required: true },
        },
      },
      render: (_args, value) => {
        const endOffset = value.offset + Math.max(value.returnedBytes - 1, 0);
        const header = [
          `CAS object ${value.ref}`,
          `type: ${value.kind} (${value.mediaType})`,
          `bytes: ${value.offset}..${endOffset} / ${value.totalBytes}`,
          "",
        ];
        const footer: string[] = [];
        if (value.truncated) {
          footer.push(
            "",
            "More available.",
            `Call dsh_cas_retrieve with offset=${value.offset + value.returnedBytes}.`,
          );
        }
        return [
          {
            type: "text",
            text: `${header.join("\n")}${value.content}${footer.join("\n")}`,
          },
        ];
      },
    },
    async execute(args: unknown) {
      const query = args as Record<string, unknown>;
      const hash = readRefArg(query);
      const config = readConfig();
      const requestedLimit = readOptionalInteger(query, "limit");
      if (requestedLimit !== undefined && requestedLimit <= 0) {
        throw new CasError(
          "CAS_INVALID_ARGUMENT",
          "limit must be a positive byte count",
        );
      }
      const limit = Math.min(
        requestedLimit ?? config.retrieval.defaultBytes,
        config.retrieval.maxBytes,
      );
      const offset = Math.max(readOptionalInteger(query, "offset") ?? 0, 0);
      const requestedEncoding =
        readOptionalString(query, "encoding", ENCODINGS) ?? "auto";

      const read = await store
        .read(hash, { offset, limit })
        .catch((error: unknown) => {
          if (
            error instanceof CasError &&
            error.code === "CAS_OBJECT_MISSING"
          ) {
            throw new CasError(
              "CAS_OBJECT_MISSING",
              missingObjectMessage(`sha256:${hash}`),
            );
          }
          throw error;
        });

      const encoding: Exclude<Encoding, "auto"> =
        requestedEncoding === "auto"
          ? read.encoding === "binary"
            ? "base64"
            : "utf8"
          : requestedEncoding;
      const bytes =
        encoding === "utf8"
          ? utf8Page(read.bytes, read.offset, read.truncated)
          : read.bytes;
      const content = encodePayload(bytes, encoding);
      counters.increment("retrievalCalls");
      counters.increment("retrievalBytes", bytes.length);
      return {
        ref: read.ref,
        kind: read.kind,
        mediaType: read.mediaType,
        encoding,
        totalBytes: read.totalSize,
        offset: read.offset,
        returnedBytes: bytes.length,
        truncated: read.truncated,
        content,
      };
    },
  });
}

function encodePayload(
  bytes: Uint8Array,
  encoding: Exclude<Encoding, "auto">,
): string {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (encoding === "base64") return buffer.toString("base64");
  if (encoding === "hex") return buffer.toString("hex");
  return new TextDecoder("utf8", { ignoreBOM: true }).decode(bytes);
}

/** Keep the next offset at a character boundary without exceeding the byte limit. */
function utf8Page(
  bytes: Uint8Array,
  offset: number,
  truncated: boolean,
): Uint8Array {
  if (!bytes.length) return bytes;
  if (offset > 0 && (bytes[0]! & 0xc0) === 0x80) {
    throw new CasError(
      "CAS_INVALID_ARGUMENT",
      "The offset is inside a UTF-8 character. Use the previous page's offset plus returnedBytes, or request base64 for arbitrary byte offsets.",
    );
  }
  if (!truncated) return bytes;
  let start = bytes.length - 1;
  while (
    start > 0 &&
    bytes.length - start <= 3 &&
    (bytes[start]! & 0xc0) === 0x80
  )
    start--;
  const tail = bytes.subarray(start);
  // A streaming decoder holds back only a genuinely unfinished sequence.
  // Invalid input still receives the usual replacement character.
  if (
    new TextDecoder("utf8", { ignoreBOM: true }).decode(tail, {
      stream: true,
    }) !== ""
  )
    return bytes;
  if (start === 0) {
    throw new CasError(
      "CAS_INVALID_ARGUMENT",
      "The byte limit is too small for the next UTF-8 character. Request at least 4 bytes or use base64.",
    );
  }
  return bytes.subarray(0, start);
}
