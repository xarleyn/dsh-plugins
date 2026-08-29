/**
 * Minimal HTTP client for the llama.cpp slots management API (SPEC §6).
 *
 * Every call is bounded by its own timeout (SPEC §59): persistence latency
 * must never block or outlive the inference path. Only plugin-generated
 * opaque filenames reach `action=save`/`action=restore` (SPEC §44).
 */

import { KvBackendUnavailableError, KvEraseFailedError, KvRestoreFailedError, KvSaveFailedError } from "../../errors.js";
import type { LlamaCppEraseResponse, LlamaCppRestoreResponse, LlamaCppSaveResponse, LlamaCppSlotsResponse } from "./types.js";

export interface LlamaCppClientOptions {
  readonly baseURL: string;
  readonly apiKey: string | null;
  readonly requestTimeoutMs: number;
  /** Injectable fetch for tests. */
  readonly fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Defensive response parsing: llama.cpp builds differ; anything missing
 * degrades to `null`/`false` rather than throwing parse errors.
 */
function parseJsonBody(text: string): Record<string, unknown> | readonly unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) || Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Normalize the GET /slots payload (array or `{ slots: [...] }`). */
export function normalizeSlotsResponse(payload: unknown): LlamaCppSlotsResponse {
  const rawSlots: unknown = Array.isArray(payload) ? payload : (isRecord(payload) ? payload.slots : undefined);
  if (!Array.isArray(rawSlots)) return { slots: [] };
  const slots = rawSlots.flatMap((entry: unknown) => {
    if (isRecord(entry) && typeof entry.id === "number") return [{ id: entry.id }];
    if (typeof entry === "number") return [{ id: entry }];
    return [];
  });
  return { slots };
}

export class LlamaCppClient {
  readonly #baseURL: string;
  readonly #apiKey: string | null;
  readonly #requestTimeoutMs: number;
  readonly #fetchImpl: typeof fetch;

  constructor(options: LlamaCppClientOptions) {
    this.#baseURL = options.baseURL.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  get baseURL(): string {
    return this.#baseURL;
  }

  async #request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<{ status: number; body: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {};
    if (this.#apiKey !== null) headers["Authorization"] = `Bearer ${this.#apiKey}`;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    try {
      const response = await this.#fetchImpl(`${this.#baseURL}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
        signal: controller.signal,
      });
      const body = await response.text();
      return { status: response.status, body };
    } catch (error) {
      throw new KvBackendUnavailableError(
        `llama.cpp server at ${this.#baseURL} is unreachable: ${String((error as Error)?.message ?? error)}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /slots — slot discovery and health probing (SPEC §34). */
  async inspectSlots(timeoutMs: number = this.#requestTimeoutMs): Promise<LlamaCppSlotsResponse> {
    const { status, body } = await this.#request("/slots", { method: "GET" }, timeoutMs);
    if (status !== 200) {
      throw new KvBackendUnavailableError(`GET /slots returned HTTP ${status}`);
    }
    return normalizeSlotsResponse(parseJsonBody(body));
  }

  /** POST /slots/{id}?action=save — persist slot KV state into a file. */
  async saveSlot(slotId: number, snapshotFilename: string, timeoutMs: number = this.#requestTimeoutMs): Promise<LlamaCppSaveResponse> {
    const { status, body } = await this.#request(
      `/slots/${slotId}?action=save`,
      { method: "POST", body: JSON.stringify({ filepath: snapshotFilename }) },
      timeoutMs,
    );
    const payload = parseJsonBody(body);
    if (status !== 200 || !isRecord(payload) || payload.success !== true) {
      throw new KvSaveFailedError(
        `save of slot ${slotId} failed (HTTP ${status}): ${body.slice(0, 200)}`,
      );
    }
    return { success: true };
  }

  /** POST /slots/{id}?action=restore — load a snapshot back into the slot. */
  async restoreSlot(slotId: number, snapshotFilename: string, timeoutMs: number = this.#requestTimeoutMs): Promise<LlamaCppRestoreResponse> {
    const { status, body } = await this.#request(
      `/slots/${slotId}?action=restore`,
      { method: "POST", body: JSON.stringify({ filepath: snapshotFilename }) },
      timeoutMs,
    );
    const payload = parseJsonBody(body);
    if (status !== 200 || !isRecord(payload)) {
      throw new KvRestoreFailedError(
        `restore of slot ${slotId} failed (HTTP ${status}): ${body.slice(0, 200)}`,
      );
    }
    const nRestored = optionalCount(payload.n_restored) ?? optionalCount(payload.nRestored);
    if (payload.success === false) {
      throw new KvRestoreFailedError(`restore of slot ${slotId} reported success=false`);
    }
    return { success: true, nRestored };
  }

  /** POST /slots/{id}?action=erase — clear slot KV state. */
  async eraseSlot(slotId: number, timeoutMs: number = this.#requestTimeoutMs): Promise<LlamaCppEraseResponse> {
    const { status, body } = await this.#request(
      `/slots/${slotId}?action=erase`,
      { method: "POST", body: JSON.stringify({}) },
      timeoutMs,
    );
    const payload = parseJsonBody(body);
    if (status !== 200 || (isRecord(payload) && payload.success === false)) {
      throw new KvEraseFailedError(`erase of slot ${slotId} failed (HTTP ${status}): ${body.slice(0, 200)}`);
    }
    return { success: true };
  }
}
