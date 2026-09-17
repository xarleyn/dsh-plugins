/**
 * The LightRAG HTTP client — the only place in this plugin that speaks to the
 * network (SPEC §3).
 *
 * Transport outcomes are folded into `LightRagError` with a stable code, and
 * every response is read through a byte cap so a misconfigured `endpoint`
 * cannot make the host buffer an unbounded body. Reads are defensive: the
 * server is an external component, so a field is read by name with a fallback
 * and never trusted for shape.
 */

import type { QueryMode, ResolvedLightRagConfig } from "./config.js";
import { LightRagError } from "./errors.js";

/** One reference the answer was built from. */
export interface LightRagReference {
  readonly referenceId: string;
  readonly filePath: string;
  /** Chunk contents, present only when the caller asked for them. */
  readonly content: readonly string[];
}

/** One answer from `POST /query`. */
export interface LightRagAnswer {
  readonly answer: string;
  readonly references: readonly LightRagReference[];
  readonly responseTimeSeconds: number | null;
  /** False when the server returned canned text without calling its LLM. */
  readonly llmGenerated: boolean | null;
}

/** One document as the knowledge base reports it. */
export interface LightRagDocument {
  readonly id: string;
  readonly filePath: string;
  readonly status: string;
  readonly chunksCount: number;
  readonly contentLength: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly trackId: string;
  readonly errorMessage: string;
}

/** `{"status": n}` pairs, flattened for a stable tool contract. */
export interface LightRagStatusCount {
  readonly status: string;
  readonly count: number;
}

/** One page of `POST /documents/paginated`, with the filtered total. */
export interface LightRagDocumentsPage {
  readonly documents: readonly LightRagDocument[];
  /** Documents matching the filter, across all pages. */
  readonly totalCount: number;
  /** Whether more documents match than this result carries. */
  readonly hasMore: boolean;
  readonly statusCounts: readonly LightRagStatusCount[];
}

/** Server health and pipeline state, read defensively from `GET /health`. */
export interface LightRagHealth {
  readonly status: string;
  readonly coreVersion: string;
  readonly apiVersion: string;
  readonly authMode: string;
  readonly pipelineBusy: boolean;
  readonly pipelineActive: boolean;
  readonly webUiTitle: string;
  readonly inputDirectory: string;
  readonly workingDirectory: string;
}

/** The `{status, message, track_id}` envelope of the ingestion endpoints. */
export interface LightRagIngestStart {
  readonly status: string;
  readonly message: string;
  readonly trackId: string;
}

/** The `{status, message, doc_id}` envelope of the delete endpoint. */
export interface LightRagDeleteResult {
  readonly status: string;
  readonly message: string;
  readonly docId: string;
}

export interface LightRagQueryRequest {
  readonly question: string;
  readonly mode: QueryMode;
  readonly topK: number;
  readonly withContent: boolean;
}

export interface LightRagDocumentsRequest {
  readonly status?: string;
  readonly limit: number;
}

export interface LightRagClient {
  health(options?: RequestOptions): Promise<LightRagHealth>;
  query(
    request: LightRagQueryRequest,
    options?: RequestOptions,
  ): Promise<LightRagAnswer>;
  documents(
    request: LightRagDocumentsRequest,
    options?: RequestOptions,
  ): Promise<LightRagDocumentsPage>;
  statusCounts(options?: RequestOptions): Promise<LightRagStatusCount[]>;
  pipelineStatus(options?: RequestOptions): Promise<Record<string, unknown>>;
  insertText(
    request: { readonly text: string; readonly source: string },
    options?: RequestOptions,
  ): Promise<LightRagIngestStart>;
  scanInputDirectory(options?: RequestOptions): Promise<LightRagIngestStart>;
  deleteDocument(
    request: { readonly documentId: string },
    options?: RequestOptions,
  ): Promise<LightRagDeleteResult>;
}

export interface RequestOptions {
  /** Caller-owned cancellation, forwarded from the tool execution. */
  readonly signal?: AbortSignal;
}

export interface LightRagClientOptions {
  /** Transport seam; tests inject a fake here. */
  readonly fetch?: typeof globalThis.fetch;
  /** Byte cap for one response body (default 2 MiB). */
  readonly maxResponseBytes?: number;
}

/** Default response cap; a well-formed answer is far below it. */
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Server page size bounds (`DocumentsRequest`); the loop stays inside them. */
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 200;
/** Pages one `documents` call may walk, so a limit cannot fan out unbounded. */
const MAX_PAGES = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Flatten the server's `{status: count}` map into a stable sorted list. */
function readStatusCounts(value: unknown): LightRagStatusCount[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .map(([status, count]) => ({
      status,
      count: typeof count === "number" && Number.isFinite(count) ? count : 0,
    }))
    .sort((left, right) => left.status.localeCompare(right.status));
}

/**
 * Why a fetch failed, in the words that help an operator. Node reports a bare
 * `fetch failed` and buries the useful part — `connect ECONNREFUSED
 * 127.0.0.1:9621`, `getaddrinfo ENOTFOUND lightrag`, `bad port` — one or two
 * `cause` levels down (or inside an `AggregateError`), so the chain is walked
 * and the deepest distinct message plus the first error code are reported.
 */
function transportReason(error: unknown): string {
  const messages: string[] = [];
  let code = "";
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    const message = (current as { message?: unknown }).message;
    if (
      typeof message === "string" &&
      message !== "" &&
      !messages.includes(message)
    ) {
      messages.push(message);
    }
    const found = (current as { code?: unknown }).code;
    if (code === "" && typeof found === "string" && found !== "") code = found;
    const errors = (current as { errors?: unknown }).errors;
    current =
      Array.isArray(errors) && errors.length > 0
        ? errors[0]
        : (current as { cause?: unknown }).cause;
  }
  const top = messages[0] ?? String(error);
  const deepest = messages.at(-1) ?? "";
  let reason = deepest !== "" && deepest !== top ? `${top}: ${deepest}` : top;
  if (code !== "" && !reason.includes(code)) reason += ` (${code})`;
  return reason;
}

/** Bounded, human-readable excerpt of an error body for the tool message. */
function detailOf(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  let detail = trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      const fields = parsed["detail"] ?? parsed["message"] ?? parsed["error"];
      if (typeof fields === "string") detail = fields;
      else if (fields !== undefined) detail = JSON.stringify(fields);
    }
  } catch {
    // Not JSON: the raw text is the detail.
  }
  const flat = detail.replaceAll(/\s+/gu, " ").trim();
  return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}

/** Fold an HTTP status into the plugin's stable error vocabulary (SPEC §4.4). */
export function errorForStatus(status: number, text: string): LightRagError {
  const detail = detailOf(text);
  const suffix = detail === "" ? "" : `: ${detail}`;
  if (status === 401 || status === 403) {
    return new LightRagError(
      "unauthorized",
      `the server rejected the API key (HTTP ${status})${suffix}`,
    );
  }
  if (status === 404) {
    return new LightRagError(
      "not-found",
      `the server has no such resource (HTTP 404)${suffix}`,
    );
  }
  if (status === 413) {
    return new LightRagError(
      "too-large",
      `the server rejected the request size (HTTP 413)${suffix}`,
    );
  }
  if (status === 400 || status === 422) {
    return new LightRagError(
      "invalid-argument",
      `the server rejected the request (HTTP ${status})${suffix}`,
    );
  }
  if (status === 429) {
    return new LightRagError(
      "rate-limited",
      `the server is throttling requests (HTTP 429)${suffix}`,
    );
  }
  return new LightRagError(
    "server-error",
    `the server answered HTTP ${status}${suffix}`,
  );
}

function requireRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new LightRagError(
      "bad-response",
      `${context} answered JSON that is not the LightRAG API`,
    );
  }
  return value;
}

/** Read at most `maxBytes` of the body, cancelling the stream past the cap. */
async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (response.body === null) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const next = await reader.read();
    if (next.done === true) break;
    bytes += next.value.byteLength;
    if (bytes > maxBytes) {
      const room = maxBytes - (bytes - next.value.byteLength);
      if (room > 0) chunks.push(next.value.subarray(0, room));
      await reader.cancel();
      truncated = true;
      break;
    }
    chunks.push(next.value);
  }
  return {
    text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
      "utf8",
    ),
    truncated,
  };
}

/**
 * Build the client bound to one resolved configuration. The returned object
 * holds no mutable state: every call is one bounded request.
 */
export function createLightRagClient(
  config: ResolvedLightRagConfig,
  options: LightRagClientOptions = {},
): LightRagClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new TypeError(
      "dsh-lightrag: no fetch implementation is available in this runtime",
    );
  }
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  async function request(
    path: string,
    init: {
      readonly method: string;
      readonly body?: unknown;
      readonly signal?: AbortSignal;
      readonly context: string;
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.apiKey !== "") headers["X-API-Key"] = config.apiKey;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.timeoutMs);
    const signal =
      init.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, init.signal]);

    let response: Response;
    try {
      response = await doFetch(`${config.endpoint}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new LightRagError(
          "timeout",
          `${init.context} did not answer within ${config.timeoutMs} ms`,
          { cause: error },
        );
      }
      if (init.signal?.aborted === true) {
        throw new LightRagError(
          "timeout",
          `${init.context} was cancelled before the server answered`,
          { cause: error },
        );
      }
      const reason = transportReason(error);
      throw new LightRagError(
        "unreachable",
        `${init.context} could not reach ${config.endpoint}: ${reason}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await readBounded(response, maxResponseBytes);
    if (!response.ok) throw errorForStatus(response.status, body.text);
    if (body.truncated) {
      throw new LightRagError(
        "too-large",
        `${init.context} answered more than ${maxResponseBytes} bytes`,
      );
    }
    if (body.text.trim() === "") return {};
    try {
      return JSON.parse(body.text) as unknown;
    } catch (error) {
      throw new LightRagError(
        "bad-response",
        `${init.context} answered a body that is not JSON`,
        { cause: error },
      );
    }
  }

  return {
    async health(requestOptions) {
      const payload = requireRecord(
        await request("/health", {
          method: "GET",
          signal: requestOptions?.signal,
          context: "health check",
        }),
        "health check",
      );
      return {
        status: readString(payload, "status"),
        coreVersion: readString(payload, "core_version"),
        apiVersion: readString(payload, "api_version"),
        authMode: readString(payload, "auth_mode"),
        pipelineBusy: payload["pipeline_busy"] === true,
        pipelineActive: payload["pipeline_active"] === true,
        webUiTitle: readString(payload, "webui_title"),
        inputDirectory: readString(payload, "input_directory"),
        workingDirectory: readString(payload, "working_directory"),
      };
    },

    async query(queryRequest, requestOptions) {
      const payload = requireRecord(
        await request("/query", {
          method: "POST",
          signal: requestOptions?.signal,
          context: "query",
          body: {
            query: queryRequest.question,
            mode: queryRequest.mode,
            top_k: queryRequest.topK,
            include_references: true,
            include_chunk_content: queryRequest.withContent,
          },
        }),
        "query",
      );
      const answer = payload["response"];
      if (typeof answer !== "string") {
        throw new LightRagError(
          "bad-response",
          "the query answer carried no response text",
        );
      }
      const rawReferences = payload["references"];
      const references: LightRagReference[] = Array.isArray(rawReferences)
        ? rawReferences.filter(isRecord).map((reference) => ({
            referenceId: readString(reference, "reference_id"),
            filePath: readString(reference, "file_path"),
            content: Array.isArray(reference["content"])
              ? reference["content"].filter(
                  (chunk): chunk is string => typeof chunk === "string",
                )
              : [],
          }))
        : [];
      const responseTime = payload["response_time"];
      const llmGenerated = payload["llm_generated"];
      return {
        answer,
        references,
        responseTimeSeconds:
          typeof responseTime === "number" && Number.isFinite(responseTime)
            ? responseTime
            : null,
        llmGenerated: typeof llmGenerated === "boolean" ? llmGenerated : null,
      };
    },

    async documents(documentsRequest, requestOptions) {
      const limit = Math.max(1, Math.floor(documentsRequest.limit));
      const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, limit));
      const documents: LightRagDocument[] = [];
      let totalCount = 0;
      let statusCounts: LightRagStatusCount[] = [];
      // Whether the server itself said another page follows, read on the last
      // page this call fetched.
      let serverHasNext = false;

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const payload = requireRecord(
          await request("/documents/paginated", {
            method: "POST",
            signal: requestOptions?.signal,
            context: "document listing",
            body: {
              ...(documentsRequest.status === undefined
                ? {}
                : { status_filters: [documentsRequest.status] }),
              page,
              page_size: pageSize,
              sort_field: "updated_at",
              sort_direction: "desc",
            },
          }),
          "document listing",
        );
        const rawDocuments = payload["documents"];
        if (!Array.isArray(rawDocuments)) {
          throw new LightRagError(
            "bad-response",
            "the document listing carried no documents array",
          );
        }
        for (const entry of rawDocuments) {
          if (!isRecord(entry)) continue;
          documents.push({
            id: readString(entry, "id"),
            filePath: readString(entry, "file_path"),
            status: readString(entry, "status"),
            chunksCount: readNumber(entry, "chunks_count"),
            contentLength: readNumber(entry, "content_length"),
            createdAt: readString(entry, "created_at"),
            updatedAt: readString(entry, "updated_at"),
            trackId: readString(entry, "track_id"),
            errorMessage: readString(entry, "error_msg"),
          });
        }
        const pagination = isRecord(payload["pagination"])
          ? payload["pagination"]
          : {};
        totalCount = readNumber(pagination, "total_count");
        serverHasNext = pagination["has_next"] === true;
        statusCounts = readStatusCounts(payload["status_counts"]);
        // Stop once the limit is met or the server says the listing ended.
        if (documents.length >= limit || !serverHasNext) break;
      }

      const returned = documents.slice(0, limit);
      return {
        documents: returned,
        totalCount,
        statusCounts,
        // Either the server still has pages we did not read, or it reported
        // more matches than this result carries.
        hasMore:
          (serverHasNext && documents.length >= limit) ||
          totalCount > returned.length,
      };
    },

    async statusCounts(requestOptions) {
      const payload = requireRecord(
        await request("/documents/status_counts", {
          method: "GET",
          signal: requestOptions?.signal,
          context: "status counts",
        }),
        "status counts",
      );
      return readStatusCounts(payload["status_counts"]);
    },

    async pipelineStatus(requestOptions) {
      return requireRecord(
        await request("/documents/pipeline_status", {
          method: "GET",
          signal: requestOptions?.signal,
          context: "pipeline status",
        }),
        "pipeline status",
      );
    },

    async insertText(insertRequest, requestOptions) {
      const payload = requireRecord(
        await request("/documents/text", {
          method: "POST",
          signal: requestOptions?.signal,
          context: "text insert",
          body: {
            text: insertRequest.text,
            ...(insertRequest.source === ""
              ? {}
              : { file_source: insertRequest.source }),
          },
        }),
        "text insert",
      );
      return {
        status: readString(payload, "status"),
        message: readString(payload, "message"),
        trackId: readString(payload, "track_id"),
      };
    },

    async scanInputDirectory(requestOptions) {
      const payload = requireRecord(
        await request("/documents/scan", {
          method: "POST",
          signal: requestOptions?.signal,
          context: "input directory scan",
        }),
        "input directory scan",
      );
      return {
        status: readString(payload, "status"),
        message: readString(payload, "message"),
        trackId: readString(payload, "track_id"),
      };
    },

    async deleteDocument(deleteRequest, requestOptions) {
      const payload = requireRecord(
        await request("/documents/delete_document", {
          method: "DELETE",
          signal: requestOptions?.signal,
          context: "document delete",
          body: {
            doc_ids: [deleteRequest.documentId],
            // The index entry goes; the operator's source file stays.
            delete_file: false,
            delete_llm_cache: false,
          },
        }),
        "document delete",
      );
      return {
        status: readString(payload, "status"),
        message: readString(payload, "message"),
        docId: readString(payload, "doc_id"),
      };
    },
  };
}
