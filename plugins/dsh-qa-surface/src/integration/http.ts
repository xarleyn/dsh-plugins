import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebServer } from "@deepseek-ai/dsh-host-webserver";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { ResolvedQaSurfaceConfig } from "../types.js";
import {
  isIntegrationDocumentMediaType,
  isIntegrationTextMediaType,
} from "./attachments.js";
import {
  QaIntegrationError,
  type QaAskAnswer,
  type QaAskContext,
  type QaAskRequest,
  type QaIntegrationAttachment,
} from "./contract.js";
import type { QaIntegrationService } from "./service.js";

/**
 * The integration API's HTTP transport.
 *
 * Two exact routes under one configurable base path — the required
 * `POST {base}/ask` and the optional `GET {base}/health` of the ticket bridge
 * contract — speaking `application/json` and `multipart/form-data`, which is
 * what the bridge sends. Everything below the transport (credentials, budgets,
 * turns) lives in {@link QaIntegrationService}; this file owns bytes, encodings
 * and status codes and nothing else.
 *
 * Method checking happens inside each handler rather than by registering one
 * route per verb: a `GET /qa/api/ask` must answer 405 with an `Allow` header,
 * and a route that only matched POST would instead fall through to the SPA
 * fallback and answer 200 with an HTML page.
 */

/** Raster formats the prompt content can carry inline; the rest need uploads. */
const INLINE_IMAGE_MEDIA_TYPES: readonly string[] = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** The bridge's own ceiling: five attachments per question. */
export const QA_INTEGRATION_MAX_FILES = 5;

export interface QaIntegrationRouteOptions {
  config: ResolvedQaSurfaceConfig;
  service: QaIntegrationService;
  logger: PluginLogger;
}

/**
 * Register the integration routes on the host web server.
 * @param webServer - the route table owner.
 * @param options - resolved config, the service and the plugin logger.
 * @returns the disposer removing every route this call registered.
 */
export function registerQaIntegrationRoutes(
  webServer: Pick<WebServer, "register">,
  options: QaIntegrationRouteOptions,
): () => void {
  const base = options.config.integration.basePath;
  const disposers = [
    webServer.register({
      kind: "exact",
      path: `${base}/ask`,
      handler: (request, response) =>
        handleAsk(request, response, options).catch(() =>
          sendRefusal(
            response,
            new QaIntegrationError(
              "unavailable",
              "the request could not be answered",
            ),
          ),
        ),
    }),
    webServer.register({
      kind: "exact",
      path: `${base}/health`,
      handler: (request, response) =>
        handleHealth(request, response, options).catch(() =>
          sendRefusal(
            response,
            new QaIntegrationError(
              "unavailable",
              "health could not be answered",
            ),
          ),
        ),
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

async function handleAsk(
  request: IncomingMessage,
  response: ServerResponse,
  options: QaIntegrationRouteOptions,
): Promise<void> {
  if (request.method !== "POST") {
    sendMethodNotAllowed(response, "POST");
    return;
  }
  try {
    const body = await readBody(
      request,
      options.config.integration.maxRequestBytes,
    );
    const parsed = parseAskBody(body, contentTypeOf(request), options.config);
    const answer = await options.service.ask(
      headerOf(request, "authorization"),
      parsed,
      clientSignal(response),
    );
    sendJson(response, 200, answerPayload(answer));
  } catch (error) {
    sendRefusal(response, error);
  }
}

async function handleHealth(
  request: IncomingMessage,
  response: ServerResponse,
  options: QaIntegrationRouteOptions,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendMethodNotAllowed(response, "GET, HEAD");
    return;
  }
  try {
    const health = await options.service.health(
      headerOf(request, "authorization"),
    );
    // The bridge reads snake_case here (its own field names), unlike the ask
    // response, which it also defines — the contract is reproduced exactly.
    sendJson(response, 200, {
      ok: health.ok,
      version: health.version,
      models: health.models,
      uptime_s: health.uptimeS,
    });
  } catch (error) {
    sendRefusal(response, error);
  }
}

/** The `{chat_id, answer, …}` body the bridge publishes from. */
function answerPayload(answer: QaAskAnswer): Record<string, unknown> {
  return {
    chat_id: answer.chatId,
    answer: answer.answer,
    sources: answer.sources,
    confidence: answer.confidence,
    escalate: answer.escalate,
    reason: answer.reason,
  };
}

/**
 * Parse one `POST /ask` body out of whichever encoding carried it.
 *
 * JSON is the primary form. Multipart exists because the bridge sends the
 * ticket's attachments through it, and images ride a prompt inline in this
 * harness — so an image-only multipart request is answered like a JSON one. A
 * non-image attachment has nowhere to go: files reach a prompt as a receipt
 * minted by the browser upload path, which an external caller has no session
 * to mint. That request is refused with 415, which is exactly the signal the
 * bridge's own fallback waits for: it repeats the question without
 * attachments rather than failing.
 *
 * @param body - the raw request body.
 * @param contentType - the request's content type, parameters included.
 * @param config - resolved config, for the attachment ceilings.
 * @returns the normalized request.
 */
export function parseAskBody(
  body: Buffer,
  contentType: string | undefined,
  config: ResolvedQaSurfaceConfig,
): QaAskRequest {
  const media = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (media === "application/json" || media === "") {
    return parseJsonAsk(body);
  }
  if (media === "multipart/form-data") {
    const boundary = boundaryOf(contentType);
    if (boundary === null) {
      throw new QaIntegrationError(
        "invalid-request",
        "multipart/form-data without a boundary parameter",
      );
    }
    return parseMultipartAsk(parseMultipart(body, boundary), config);
  }
  throw new QaIntegrationError(
    "unsupported-media",
    `unsupported content type ${media}`,
  );
}

function parseJsonAsk(body: Buffer): QaAskRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new QaIntegrationError(
      "invalid-request",
      "the body is not valid JSON",
    );
  }
  return fromFields(record(parsed), null);
}

const MAX_MESSAGE_CHARS = 200_000;
const MAX_CONTEXT_CHARS = 4_000;

/** One image part of a multipart body, bounded as it was read. */
interface MultipartFile {
  readonly filename: string;
  readonly mediaType: string;
  readonly bytes: Buffer;
}

interface MultipartBody {
  readonly fields: ReadonlyMap<string, string>;
  readonly files: readonly MultipartFile[];
}

function parseMultipartAsk(
  multipart: MultipartBody,
  config: ResolvedQaSurfaceConfig,
): QaAskRequest {
  const attachments: QaIntegrationAttachment[] = [];
  for (const file of multipart.files) {
    const media = file.mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (file.bytes.length > config.integration.maxAttachmentBytes) {
      throw new QaIntegrationError(
        "payload-too-large",
        `attachment ${file.filename} exceeds the configured limit`,
      );
    }
    if (INLINE_IMAGE_MEDIA_TYPES.includes(media)) {
      // An image is the one attachment the prompt carries as bytes.
      attachments.push(
        Object.freeze({
          kind: "image" as const,
          mediaType: media,
          data: file.bytes.toString("base64"),
          ...(file.filename === "" ? {} : { name: file.filename }),
        }),
      );
      continue;
    }
    if (
      !isIntegrationTextMediaType(media) &&
      !isIntegrationDocumentMediaType(media)
    ) {
      // Deliberate 415: it makes the bridge send the question again without
      // attachments, publishing an answer instead of failing the ticket. The
      // accepted families are the caller's own filter (text, PDF, OOXML);
      // archives, executables and media never get here from the bridge, and a
      // caller that sends them gets the fallback rather than a prompt full of
      // bytes the model cannot read.
      throw new QaIntegrationError(
        "unsupported-media",
        `unsupported attachment type ${media}; repeat the request without attachments`,
      );
    }
    // A document is read on the Host — decoded when its bytes are the content,
    // extracted through the document pipeline otherwise — and joins the prompt
    // as text. Nothing is stored, so the bytes are all this layer keeps.
    attachments.push(
      Object.freeze({
        kind: "file" as const,
        mediaType: media,
        // A file name has to survive being a file name: a media type carries a
        // slash, which a temporary file on Windows cannot.
        name:
          file.filename === ""
            ? `attachment.${media.replace("/", ".")}`
            : file.filename,
        bytes: file.bytes,
      }),
    );
  }
  const context = parseContextField(multipart.fields.get("context"));
  return fromFields(
    {
      message: multipart.fields.get("message"),
      version: emptyToNull(multipart.fields.get("version")),
      session_id: emptyToNull(multipart.fields.get("session_id")),
      context: {
        ticket_key: context.ticketKey,
        reporter: context.reporter,
        reporter_name: context.reporterName,
      },
    },
    attachments,
  );
}

/**
 * Normalize the fields both encodings share into one request, refusing what a
 * turn cannot be opened with.
 * @param fields - the request as an object, however it arrived.
 * @param attachments - inline images, or null for the JSON encoding.
 * @returns the validated request.
 */
function fromFields(
  fields: Record<string, unknown> | undefined,
  attachments: readonly QaIntegrationAttachment[] | null,
): QaAskRequest {
  const message = typeof fields?.message === "string" ? fields.message : "";
  if (message.trim() === "") {
    throw new QaIntegrationError("invalid-request", "message is required");
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new QaIntegrationError(
      "payload-too-large",
      "message is longer than the accepted maximum",
    );
  }
  const context = fields === undefined ? undefined : record(fields.context);
  return Object.freeze({
    message,
    version: stringOrNull(fields?.version),
    sessionId: stringOrNull(fields?.session_id ?? fields?.sessionId),
    context:
      context === undefined
        ? EMPTY_CONTEXT
        : Object.freeze({
            ticketKey: stringOrNull(context.ticket_key ?? context.ticketKey),
            reporter: stringOrNull(context.reporter),
            reporterName: stringOrNull(
              context.reporter_name ?? context.reporterName,
            ),
          }),
    attachments: Object.freeze([...(attachments ?? [])]),
  });
}

const EMPTY_CONTEXT: QaAskContext = Object.freeze({
  ticketKey: null,
  reporter: null,
  reporterName: null,
});

/** The `context` field of a multipart form: a JSON string, not an object. */
function parseContextField(raw: string | undefined): QaAskContext {
  const value = raw === undefined ? "" : raw.trim();
  if (value === "") return EMPTY_CONTEXT;
  if (value.length > MAX_CONTEXT_CHARS) {
    throw new QaIntegrationError(
      "invalid-request",
      "the context field is too long",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new QaIntegrationError(
      "invalid-request",
      "the context field is not valid JSON",
    );
  }
  const entry = record(parsed) ?? {};
  return Object.freeze({
    ticketKey: stringOrNull(entry.ticket_key ?? entry.ticketKey),
    reporter: stringOrNull(entry.reporter),
    reporterName: stringOrNull(entry.reporter_name ?? entry.reporterName),
  });
}

/**
 * Split a multipart body into its text fields and files.
 *
 * Hand-written and deliberately minimal: one request shape (a flat form of
 * scalar fields and `files` parts), one boundary, no nested multiparts. The
 * body is already bounded by the caller, so no part can grow without limit.
 *
 * @param body - the raw request body.
 * @param boundary - the boundary parameter of the content type.
 * @returns text fields and file parts, in the order they appeared.
 */
export function parseMultipart(body: Buffer, boundary: string): MultipartBody {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map<string, string>();
  const files: MultipartFile[] = [];
  let cursor = body.indexOf(delimiter);
  if (cursor === -1) {
    throw new QaIntegrationError(
      "invalid-request",
      "the multipart body does not contain its boundary",
    );
  }
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    // A closing delimiter is "--" right after the boundary.
    if (body.subarray(start, start + 2).toString("latin1") === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) {
      throw new QaIntegrationError(
        "invalid-request",
        "the multipart body is truncated",
      );
    }
    // Each part is "\r\n" headers "\r\n\r\n" content "\r\n".
    const raw = body.subarray(start, next);
    const split = raw.indexOf("\r\n\r\n");
    if (split !== -1) {
      const headers = raw.subarray(0, split).toString("utf8");
      const content = raw.subarray(split + 4);
      const trimmed = content.subarray(
        0,
        content.length >= 2 &&
          content[content.length - 2] === 0x0d &&
          content[content.length - 1] === 0x0a
          ? content.length - 2
          : content.length,
      );
      const part = parsePartHeaders(headers);
      if (part !== null) {
        if (part.filename === null) {
          fields.set(part.name, trimmed.toString("utf8"));
        } else {
          files.push(
            Object.freeze({
              filename: part.filename,
              mediaType: part.contentType ?? "application/octet-stream",
              bytes: Buffer.from(trimmed),
            }),
          );
        }
      }
    }
    cursor = next;
  }
  if (files.length > QA_INTEGRATION_MAX_FILES) {
    throw new QaIntegrationError(
      "invalid-request",
      `at most ${String(QA_INTEGRATION_MAX_FILES)} attachments are accepted`,
    );
  }
  return Object.freeze({ fields, files: Object.freeze(files) });
}

function parsePartHeaders(headers: string): {
  name: string;
  filename: string | null;
  contentType: string | undefined;
} | null {
  let name: string | null = null;
  let filename: string | null = null;
  let contentType: string | undefined;
  for (const line of headers.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "content-disposition") {
      name = parameterOf(value, "name");
      filename = parameterOf(value, "filename");
    } else if (key === "content-type") {
      contentType = value;
    }
  }
  if (name === null) return null;
  return { name, filename, contentType };
}

/** One quoted parameter of a header value, or null when it is absent. */
function parameterOf(value: string, key: string): string | null {
  const match = new RegExp(`${key}="([^"]*)"`, "iu").exec(value);
  return match?.[1] ?? null;
}

function boundaryOf(contentType: string | undefined): string | null {
  if (typeof contentType !== "string") return null;
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/iu.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary === undefined || boundary === "" ? null : boundary;
}

/**
 * Read the whole request body under a byte ceiling.
 * @param request - the incoming request.
 * @param limit - accepted body size in bytes.
 * @returns the body.
 */
export async function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  const declared = Number(headerOf(request, "content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new QaIntegrationError(
      "payload-too-large",
      "the request body is larger than the configured limit",
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) {
      throw new QaIntegrationError(
        "payload-too-large",
        "the request body is larger than the configured limit",
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function contentTypeOf(request: IncomingMessage): string | undefined {
  return headerOf(request, "content-type");
}

function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers?.[name];
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value[0] : undefined;
}

/**
 * The caller's own lifetime: a dropped connection stops the turn's wait.
 *
 * Watched on the *response*, not the request. A request's `close` fires as
 * soon as its body has been consumed — which is before the turn even starts —
 * so watching it would abort every request that was read successfully. The
 * response's `close` fires when the exchange is over, and
 * `writableFinished` says which way it ended: a finished response was
 * delivered, an unfinished one was abandoned by the client.
 * @param response - the response being written.
 * @returns a signal aborted only when the client goes away.
 */
function clientSignal(response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableFinished) {
      controller.abort(new Error("the client disconnected"));
    }
  });
  return controller.signal;
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  response.end(body);
}

/**
 * One refusal, mapped onto its status.
 *
 * An unexpected error is answered as `unavailable` rather than leaking a stack
 * trace: the bridge retries a 5xx, and the deployment's own log holds the
 * detail.
 */
export function sendRefusal(response: ServerResponse, error: unknown): void {
  const refusal =
    error instanceof QaIntegrationError
      ? error
      : new QaIntegrationError(
          "unavailable",
          "the request could not be answered",
        );
  sendJson(response, refusal.status, {
    error: refusal.message,
    code: refusal.reason,
  });
}

function sendMethodNotAllowed(response: ServerResponse, allow: string): void {
  const body = Buffer.from(
    JSON.stringify({ error: "method not allowed", code: "invalid-request" }),
    "utf8",
  );
  response.writeHead(405, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    allow,
    "cache-control": "no-store",
  });
  response.end(body);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === "" ? null : value.trim();
}
