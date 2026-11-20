/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */

// GENERATED FROM examples/memory-plugin-shared/lib. DO NOT EDIT.
/**
 * Shared stdio -> streamable-HTTP MCP proxy core for OpenViking memory plugins.
 *
 * Harness-specific entrypoints provide credential/config loading; this module
 * owns only transport, session retry, SSE parsing, and protocol-clean stdio.
 */

import { statSync } from "node:fs";
import { createInterface } from "node:readline";

import type { McpProxyConfig } from "./mcp-proxy-config.js";

const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const DELETE_TIMEOUT_MS = 2000;
const MAX_CONCURRENT_REQUESTS = 16;

/** A JSON-RPC message crossing stdio; only the probed fields are named. */
interface JsonRpcMessage {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

/** The fields the proxy reads off a JSON-RPC `result` payload. */
interface JsonRpcResult {
  readonly protocolVersion?: unknown;
  readonly tools?: unknown;
}

/** A locally provided tool; only `name` is read by the proxy. */
export interface LocalTool {
  readonly name?: unknown;
  readonly [key: string]: unknown;
}

/** The error payload a {@link RequestGuard} answers a rejected request with. */
export interface RequestGuardRejection {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** A harness-supplied check answered before the upstream is consulted. */
export interface RequestGuard {
  /**
   * Inspect one client request before forwarding. Return an error payload to
   * answer the request with instead, or null to forward it upstream.
   */
  guardRequest(message: JsonRpcMessage): RequestGuardRejection | null;
}

/** A JSON-RPC error response, i.e. what `errorResponse` builds. */
interface JsonRpcErrorResponse {
  readonly jsonrpc: string;
  readonly id: unknown;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

/** What one `postToMcp` round trip resolved to. */
interface McpPostResult {
  readonly status: number;
  readonly messages: JsonRpcMessage[];
}

/** The logger surface a harness's `loggerFactory` must return. */
interface ProxyLogger {
  log(stage: string, data?: unknown): void;
  logError(stage: string, err: unknown): void;
}

/** A harness-supplied set of tools answered in-process. */
interface LocalToolProvider {
  listTools(): unknown[];
  callTool(
    params: unknown,
    context: { readonly config: McpProxyConfig },
  ): Promise<unknown>;
}

/** Injected dependencies and stdio streams. */
interface CreateOpenVikingMcpProxyOptions {
  readonly stdin?: NodeJS.ReadableStream;
  readonly stdout?: NodeJS.WritableStream;
  readonly readConfig?: () => McpProxyConfig;
  readonly loggerFactory?: (
    hookName: string,
    config: McpProxyConfig,
  ) => ProxyLogger;
  readonly fetchImpl?: typeof fetch;
  readonly localToolProvider?: LocalToolProvider | null;
  readonly requestGuard?: RequestGuard | null;
  /**
   * Rewrite or drop one upstream tool of a `tools/list` answer. Returning a
   * tool replaces it; returning null removes it from the advertised list.
   */
  readonly adjustUpstreamTool?: (tool: LocalTool) => LocalTool | null;
}

/** The stdio-facing surface the proxy exposes to an entrypoint. */
export interface OpenVikingMcpProxy {
  start(): { close(): Promise<void> | void } | { close(): void };
  handleMessage(message: unknown): Promise<void>;
  parseSseMessages(text: string): unknown[];
  closeSession(): Promise<void>;
}

class HttpStatusError extends Error {
  readonly status: number;

  readonly statusText: string;

  readonly bodyText: string;

  readonly messages: unknown[];

  constructor(
    status: number,
    statusText: string,
    bodyText: string,
    messages: unknown[] = [],
  ) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.statusText = statusText;
    this.bodyText = bodyText;
    this.messages = messages;
  }
}

function snapshotPaths(
  paths: readonly string[] | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const path of paths || []) {
    try {
      const st = statSync(path);
      out.set(path, `${st.mtimeMs}:${st.size}`);
    } catch {
      out.set(path, "missing");
    }
  }
  return out;
}

function snapshotsDiffer(
  a: Map<string, string>,
  b: Map<string, string>,
): boolean {
  if (a.size !== b.size) return true;
  for (const [key, value] of a.entries()) {
    if (b.get(key) !== value) return true;
  }
  return false;
}

function createSemaphore(limit: number) {
  let active = 0;
  const queue = new Set<() => void>();
  function releaseOnce() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = queue.values().next().value;
      // Transfer the occupied permit directly to the oldest waiter.
      if (next) next();
      else active -= 1;
    };
  }
  return async function acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (active < limit) {
      active += 1;
      return releaseOnce();
    }
    return new Promise((resolve, reject) => {
      function grant() {
        queue.delete(grant);
        signal.removeEventListener("abort", abort);
        resolve(releaseOnce());
      }
      function abort() {
        queue.delete(grant);
        reject(signal.reason);
      }
      queue.add(grant);
      signal.addEventListener("abort", abort, { once: true });
    });
  };
}

type PostPhase = "queue" | "upstream";
class ProxyTimeout extends Error {
  constructor(
    readonly phase: PostPhase,
    readonly timeoutMs: number,
    readonly url: string,
  ) {
    super(
      phase === "queue"
        ? "Timed out waiting for an HTTP slot"
        : "Upstream HTTP request timed out",
    );
  }
}

interface PendingRequest {
  controller: AbortController;
  dispatched: boolean;
}

function isRequest(message: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(message || {}, "id");
}

function messageId(message: unknown): unknown {
  return isRequest(message)
    ? (message as { readonly id?: unknown }).id
    : undefined;
}

function errorResponse(
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  const error: { code: number; message: string; data?: unknown } = {
    code,
    message,
  };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error };
}

function parseMaybeJson(text: unknown): unknown {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Read a message's `result` payload as the typed shape the proxy probes. */
function resultOf(
  message: JsonRpcMessage | null | undefined,
): JsonRpcResult | null | undefined {
  return message?.result as JsonRpcResult | null | undefined;
}

function parseSseMessages(text: unknown): unknown[] {
  const messages: unknown[] = [];
  let dataLines: string[] = [];

  function flush(): void {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data || data === "[DONE]") return;
    messages.push(JSON.parse(data));
  }

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    if (rawLine === "") {
      flush();
      continue;
    }
    if (rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
  }
  flush();
  return messages;
}

function parseHttpBody(contentType: unknown, text: unknown): unknown[] {
  const ctype = String(contentType || "").toLowerCase();
  if (!String(text || "").trim()) return [];
  if (ctype.includes("text/event-stream")) return parseSseMessages(text);
  const json = parseMaybeJson(text);
  return json == null ? [] : [json];
}

function serializeBodyForError(bodyText: unknown): string {
  const parsed = parseMaybeJson(bodyText) as
    | {
        readonly error?: { readonly message?: unknown } | null;
        readonly detail?: unknown;
      }
    | null
    | undefined;
  if (parsed?.error?.message) return parsed.error.message as string;
  if (parsed?.detail)
    return typeof parsed.detail === "string"
      ? parsed.detail
      : JSON.stringify(parsed.detail);
  const compact = String(bodyText || "")
    .replace(/\s+/g, " ")
    .trim();
  return compact.slice(0, 500);
}

function cloneMessage(message: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
}

export function createOpenVikingMcpProxy({
  stdin = process.stdin,
  stdout = process.stdout,
  readConfig,
  loggerFactory,
  fetchImpl = globalThis.fetch,
  localToolProvider = null,
  requestGuard = null,
  adjustUpstreamTool,
}: CreateOpenVikingMcpProxyOptions = {}): OpenVikingMcpProxy {
  if (typeof fetchImpl !== "function") {
    throw new Error("global fetch is required; use Node.js 18 or newer");
  }
  if (typeof readConfig !== "function") {
    throw new Error("readConfig function is required");
  }
  if (typeof loggerFactory !== "function") {
    throw new Error("loggerFactory function is required");
  }

  // Bound to `const` after the guards: the narrowing those guards establish is
  // not preserved inside the closures below.
  const readConfigFn: () => McpProxyConfig = readConfig;
  const loggerFactoryFn: (
    hookName: string,
    config: McpProxyConfig,
  ) => ProxyLogger = loggerFactory;

  let proxyConfig: McpProxyConfig = readConfigFn();
  let logger: ProxyLogger = loggerFactoryFn("mcp-proxy", proxyConfig);
  let watchedSnapshot: Map<string, string> = snapshotPaths(
    proxyConfig.watchedPaths,
  );
  let sessionId = "";
  let initializeRequest: Record<string, unknown> | null = null;
  let initializedNotification: Record<string, unknown> | null = null;
  let protocolVersion = DEFAULT_PROTOCOL_VERSION;
  let initializeInFlight: Promise<unknown> | null = null;
  let reinitializeInFlight: Promise<void> | null = null;
  let stdoutChain: Promise<void> = Promise.resolve();
  const lifetime = new AbortController();
  const pending = new Map<unknown, PendingRequest>();
  let closing: Promise<void> | undefined;
  let reinitCounter = 0;
  const acquire = createSemaphore(MAX_CONCURRENT_REQUESTS);

  function log(stage: string, data?: unknown): void {
    try {
      logger.log(stage, data);
    } catch {
      /* debug logging must never affect protocol IO */
    }
  }

  function logError(stage: string, err: unknown): void {
    try {
      logger.logError(stage, err);
    } catch {
      /* debug logging must never affect protocol IO */
    }
  }

  function localTools(): LocalTool[] {
    if (!localToolProvider || typeof localToolProvider.listTools !== "function")
      return [];
    const tools = localToolProvider.listTools();
    return Array.isArray(tools) ? (tools as LocalTool[]) : [];
  }

  function appendLocalTools(
    message: JsonRpcMessage,
    outbound: JsonRpcMessage,
  ): JsonRpcMessage {
    const result = resultOf(outbound);
    const tools = result?.tools;
    if (message.method !== "tools/list" || !Array.isArray(tools)) {
      return outbound;
    }
    const additions = localTools().filter((tool) => tool?.name);
    if (additions.length === 0 && !adjustUpstreamTool) return outbound;
    const localNames = new Set(additions.map((tool) => tool?.name));
    const upstreamTools = tools
      .filter((tool) => !localNames.has(tool?.name))
      .map((tool) =>
        adjustUpstreamTool ? adjustUpstreamTool(tool as LocalTool) : tool,
      )
      .filter((tool) => tool !== null);
    if (additions.length === 0) {
      return {
        ...outbound,
        result: { ...(result as JsonRpcResult), tools: upstreamTools },
      };
    }
    return {
      ...outbound,
      result: {
        ...(result as JsonRpcResult),
        tools: [...upstreamTools, ...additions],
      },
    };
  }

  async function callLocalTool(message: JsonRpcMessage): Promise<unknown> {
    if (
      message.method !== "tools/call" ||
      !localToolProvider ||
      typeof localToolProvider.callTool !== "function"
    ) {
      return null;
    }
    const name = (message.params as { readonly name?: unknown } | undefined)
      ?.name;
    if (!localTools().some((tool) => tool?.name === name)) return null;
    reloadIfCredentialFilesChanged("local_tool_call");
    return localToolProvider.callTool(message.params, { config: proxyConfig });
  }

  function reloadConfig(reason: string): void {
    proxyConfig = readConfigFn();
    logger = loggerFactoryFn("mcp-proxy", proxyConfig);
    watchedSnapshot = snapshotPaths(proxyConfig.watchedPaths);
    log("credentials_reloaded", {
      reason,
      credentialSource: proxyConfig.credentialSource,
      credentialPath: proxyConfig.credentialPath,
      mcpUrl: proxyConfig.mcpUrl,
      hasApiKey: Boolean(proxyConfig.apiKey),
      hasIdentity: Boolean(proxyConfig.account || proxyConfig.user),
      hasPeer: Boolean(proxyConfig.peerId),
    });
  }

  function reloadIfCredentialFilesChanged(reason: string): boolean {
    const next = snapshotPaths(proxyConfig.watchedPaths);
    if (!snapshotsDiffer(watchedSnapshot, next)) return false;
    reloadConfig(reason);
    return true;
  }

  function headersForRequest(
    includeSession: boolean = true,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      // Always the proxy's current version (default, then server-negotiated) —
      // never the client's un-negotiated ask, which strict upstreams reject
      // with HTTP 400 before initialize negotiation can run.
      "MCP-Protocol-Version": protocolVersion,
    };
    if (includeSession && sessionId) headers["Mcp-Session-Id"] = sessionId;
    if (proxyConfig.apiKey)
      headers.Authorization = `Bearer ${proxyConfig.apiKey}`;
    if (proxyConfig.account)
      headers["X-OpenViking-Account"] = proxyConfig.account;
    if (proxyConfig.user) headers["X-OpenViking-User"] = proxyConfig.user;
    if (proxyConfig.peerId)
      headers["X-OpenViking-Actor-Peer"] = proxyConfig.peerId;
    if (proxyConfig.userAgent) headers["User-Agent"] = proxyConfig.userAgent;
    return headers;
  }

  function writeMessage(obj: JsonRpcMessage): Promise<void> {
    const line = `${JSON.stringify(obj)}\n`;
    stdoutChain = stdoutChain
      .then(
        () =>
          new Promise<void>((resolve) => stdout.write(line, () => resolve())),
      )
      .catch(() => {});
    return stdoutChain;
  }

  function mapError(
    message: JsonRpcMessage,
    err: unknown,
  ): JsonRpcErrorResponse {
    const id = messageId(message);
    if (err instanceof HttpStatusError) {
      if (err.status === 401 || err.status === 403) {
        return errorResponse(
          id,
          -32001,
          `OpenViking MCP authentication failed (HTTP ${err.status}). Check ~/.openviking/ovcli.conf or OPENVIKING_API_KEY, and verify the configured account/user for trusted mode.`,
          {
            status: err.status,
            credentialSource: proxyConfig.credentialSource,
            credentialPath: proxyConfig.credentialPath || undefined,
            serverMessage: serializeBodyForError(err.bodyText) || undefined,
          },
        );
      }
      return errorResponse(
        id,
        -32002,
        `OpenViking MCP upstream returned HTTP ${err.status}.`,
        {
          status: err.status,
          serverMessage: serializeBodyForError(err.bodyText) || undefined,
        },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ProxyTimeout) {
      return errorResponse(
        id,
        -32004,
        `OpenViking MCP request timed out after ${err.timeoutMs}ms (${err.url}). ${err.message}.`,
        {
          timeoutMs: err.timeoutMs,
          mcpUrl: err.url,
          phase: err.phase,
          cause: msg,
        },
      );
    }
    return errorResponse(
      id,
      -32001,
      `OpenViking MCP request failed. Check the configured URL (${proxyConfig.mcpUrl}) and that the OpenViking server (\`openviking-server\`) is reachable.`,
      { cause: msg },
    );
  }

  async function postToMcp(
    message: JsonRpcMessage,
    {
      includeSession = true,
      timeoutMs = proxyConfig.timeoutMs,
      request,
    }: {
      readonly includeSession?: boolean;
      readonly timeoutMs?: number;
      readonly request?: PendingRequest | undefined;
    } = {},
  ): Promise<McpPostResult> {
    let url = proxyConfig.mcpUrl;
    const deadline = performance.now() + timeoutMs;
    let phase: PostPhase = "queue";
    const controller = new AbortController();
    const signals = [controller.signal, lifetime.signal];
    if (request) signals.push(request.controller.signal);
    const signal = AbortSignal.any(signals);
    const expire = () =>
      controller.abort(new ProxyTimeout(phase, timeoutMs, url));
    const timer = setTimeout(expire, timeoutMs);
    let release: (() => void) | undefined;
    try {
      release = await acquire(signal);
      if (performance.now() >= deadline) expire();
      signal.throwIfAborted();
      phase = "upstream";
      url = proxyConfig.mcpUrl; // The endpoint and credential headers may reload together while queued.
      if (request) request.dispatched = true;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: headersForRequest(includeSession),
        body: JSON.stringify(message),
        signal,
      });
      const text = await res.text();
      signal.throwIfAborted();
      const messages = parseHttpBody(
        res.headers.get("content-type"),
        text,
      ) as JsonRpcMessage[];
      const nextSessionId = res.headers.get("mcp-session-id");
      if (nextSessionId) sessionId = nextSessionId;
      if (message?.method === "initialize" && res.ok) {
        const negotiated = resultOf(
          messages.find(
            (m) => typeof resultOf(m)?.protocolVersion === "string",
          ),
        )?.protocolVersion;
        if (negotiated) protocolVersion = negotiated as string;
      }
      if (!res.ok) {
        throw new HttpStatusError(res.status, res.statusText, text, messages);
      }
      return { status: res.status, messages };
    } catch (error) {
      // Fetch implementations may replace the signal reason with a generic abort error.
      signal.throwIfAborted();
      throw error;
    } finally {
      clearTimeout(timer);
      release?.();
    }
  }

  async function deleteSession(): Promise<void> {
    if (!sessionId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
    try {
      await fetchImpl(proxyConfig.mcpUrl, {
        method: "DELETE",
        headers: headersForRequest(true),
        signal: controller.signal,
      });
    } catch (err) {
      logError("delete_session_failed", err);
    } finally {
      clearTimeout(timer);
      sessionId = "";
    }
  }

  async function reinitialize(failedSessionId: string): Promise<void> {
    if (!initializeRequest) {
      throw new Error(
        "MCP session expired before initialize parameters were cached",
      );
    }
    if (reinitializeInFlight) return reinitializeInFlight;
    reinitializeInFlight = (async () => {
      if (failedSessionId && sessionId && sessionId !== failedSessionId) return;
      const reinit = cloneMessage(initializeRequest);
      reinit.id = `openviking-proxy-reinit-${Date.now()}-${++reinitCounter}`;
      sessionId = "";
      const result = await postToMcp(reinit, { includeSession: false });
      if (initializedNotification) {
        await postToMcp(cloneMessage(initializedNotification), {
          includeSession: true,
        });
      }
      log("reinitialized", {
        mcpUrl: proxyConfig.mcpUrl,
        status: result.status,
        sessionId: Boolean(sessionId),
      });
    })().finally(() => {
      reinitializeInFlight = null;
    });
    return reinitializeInFlight;
  }

  async function sendWithRetry(
    message: JsonRpcMessage,
    { expectsResponse }: { readonly expectsResponse: boolean },
    request?: PendingRequest,
  ): Promise<McpPostResult> {
    if (message.method !== "initialize" && initializeInFlight) {
      await initializeInFlight.catch(() => {});
    }

    const failedSessionId = sessionId;
    try {
      return await postToMcp(message, {
        includeSession: message.method !== "initialize",
        request,
      });
    } catch (err) {
      lifetime.signal.throwIfAborted();
      request?.controller.signal.throwIfAborted();
      if (
        err instanceof HttpStatusError &&
        (err.status === 401 || err.status === 403)
      ) {
        if (reloadIfCredentialFilesChanged("auth_failure")) {
          sessionId = "";
          if (message.method !== "initialize" && initializeRequest) {
            await reinitialize(failedSessionId);
          }
          return await postToMcp(message, {
            includeSession: message.method !== "initialize",
            request,
          });
        }
      }
      if (
        err instanceof HttpStatusError &&
        (err.status === 400 || err.status === 404) &&
        message.method !== "initialize" &&
        initializeRequest
      ) {
        await reinitialize(failedSessionId);
        return await postToMcp(message, { includeSession: true, request });
      }
      if (!expectsResponse) {
        logError("notification_failed", err);
      }
      throw err;
    }
  }

  async function handleMessage(message: unknown): Promise<void> {
    if (lifetime.signal.aborted) return;
    if (
      !message ||
      typeof message !== "object" ||
      (message as JsonRpcMessage).jsonrpc !== "2.0"
    ) {
      await writeMessage(
        errorResponse(null, -32600, "Invalid JSON-RPC message"),
      );
      return;
    }

    const request = message as JsonRpcMessage;
    const expectsResponse = isRequest(request);
    if (!expectsResponse && request.method === "notifications/cancelled") {
      const target = pending.get(
        (request.params as { requestId?: unknown } | null)?.requestId,
      );
      if (target) {
        target.controller.abort();
        if (!target.dispatched) return;
      }
    }
    const operation =
      expectsResponse && request.method !== "initialize"
        ? { controller: new AbortController(), dispatched: false }
        : undefined;
    if (operation) pending.set(request.id, operation);
    if (request.method === "initialize") {
      initializeRequest = cloneMessage(request);
      protocolVersion = DEFAULT_PROTOCOL_VERSION;
      sessionId = "";
    }
    if (request.method === "notifications/initialized") {
      initializedNotification = cloneMessage(request);
    }

    try {
      const rejection = requestGuard?.guardRequest(request) ?? null;
      if (rejection) {
        if (expectsResponse) {
          await writeMessage(
            errorResponse(
              request.id,
              rejection.code,
              rejection.message,
              rejection.data,
            ),
          );
        }
        return;
      }
      const localResult = await callLocalTool(request);
      if (operation?.controller.signal.aborted || lifetime.signal.aborted)
        return;
      if (localResult !== null) {
        if (expectsResponse) {
          await writeMessage({
            jsonrpc: "2.0",
            id: request.id,
            result: localResult,
          });
        }
        return;
      }
      const send = sendWithRetry(request, { expectsResponse }, operation);
      if (request.method === "initialize") {
        initializeInFlight = send
          .catch(() => {})
          .finally(() => {
            initializeInFlight = null;
          });
      }
      const result = await send;
      if (
        !expectsResponse ||
        operation?.controller.signal.aborted ||
        lifetime.signal.aborted
      )
        return;
      if (result.messages.length === 0) {
        await writeMessage(
          errorResponse(
            request.id,
            -32003,
            "OpenViking MCP upstream returned an empty response",
          ),
        );
        return;
      }
      for (const outbound of result.messages) {
        await writeMessage(appendLocalTools(request, outbound));
      }
    } catch (err) {
      if (operation?.controller.signal.aborted || lifetime.signal.aborted)
        return;
      if (expectsResponse) {
        await writeMessage(mapError(request, err));
      } else {
        logError("notification_unhandled", err);
      }
    } finally {
      if (operation && pending.get(request.id) === operation)
        pending.delete(request.id);
    }
  }

  async function handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      await writeMessage(errorResponse(null, -32700, "Parse error"));
      return;
    }
    await handleMessage(message);
  }

  function closeSession(): Promise<void> {
    lifetime.abort();
    return (closing ??= deleteSession().then(() => stdoutChain));
  }

  function start(): { close: () => Promise<void> } {
    log("start", {
      mcpUrl: proxyConfig.mcpUrl,
      credentialSource: proxyConfig.credentialSource,
      credentialPath: proxyConfig.credentialPath,
      hasApiKey: Boolean(proxyConfig.apiKey),
    });
    const rl = createInterface({
      input: stdin,
      crlfDelay: Infinity,
      terminal: false,
    });
    function stop(code = 0): Promise<void> {
      if (!closing) process.exitCode = code;
      const done = closeSession();
      rl.close();
      stdin.pause();
      return done;
    }
    rl.on("line", (line: string) => {
      void handleLine(line);
    });
    rl.on("close", () => {
      void stop();
    });
    process.on("SIGINT", () => {
      void stop(130);
    });
    process.on("SIGTERM", () => {
      void stop(143);
    });
    return { close: () => stop() };
  }

  return { start, handleMessage, parseSseMessages, closeSession };
}
