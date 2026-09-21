/**
 * The boundary every integration provider shares, asserted once instead of
 * seven times: the deployment's byte cap, a refused redirect, the retry policy,
 * the shape of a folded failure, and the one place a secret may travel.
 *
 * A provider passes by describing one of its own reads — see
 * `tests/<provider>/conformance.test.ts`. The suite is behaviour-only: it never
 * reads a provider's source, so it survives refactors and fails the moment a
 * provider stops refusing a redirect, carries its secret somewhere new, or
 * loses the byte cap. A provider whose read genuinely differs declares the
 * difference in its target instead of dropping the check.
 */
import { describe, expect, it } from "vitest";

import { IntegrationError } from "../src/errors.js";

/** One upstream call, as the suite recorded it. */
export interface RecordedUpstreamCall {
  readonly url: URL;
  readonly init: RequestInit;
}

export interface ConformanceAnswer {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly json?: unknown;
}

/** Where a credential's secret is allowed to appear — and nowhere else. */
export type ConformanceCarrier =
  | {
      readonly kind: "header";
      readonly name: string;
      /** The exact value the provider must send. */
      readonly value: string;
    }
  | {
      readonly kind: "url";
      /** The part of the target the secret owns. */
      readonly value: string;
    };

export interface ConformanceTarget {
  /** Provider id, named in every failure. */
  readonly provider: string;
  /** The read this target stands for, for the suite's own description. */
  readonly operation: string;
  /** A well-formed answer for that read, which the suite also parses. */
  readonly answer: unknown;
  /** The method every call of this read must use. */
  readonly method: "GET" | "POST";
  /** The secret inside the credential: allowed in the carrier, nowhere else. */
  readonly secret: string;
  readonly carrier: ConformanceCarrier;
  /** The statuses this provider names, and the code each one answers with. */
  readonly statuses: ReadonlyArray<readonly [number, string]>;
  /**
   * The status this provider treats as transient, how many attempts a
   * persisting answer costs, and the code the last attempt answers with. One
   * attempt means the provider deliberately does not retry this read.
   */
  readonly transient: {
    readonly status: number;
    readonly attempts: number;
    readonly code: string;
  };
  /**
   * Build the provider around this fetcher and configuration and answer a
   * function that performs the declared read once.
   */
  build(options: {
    readonly fetcher: typeof fetch;
    readonly retries: number;
    readonly maxResponseBytes: number;
  }): () => Promise<unknown>;
}

/** The payload the suite watches: it must never reach an error or a header. */
const UPSTREAM_DETAIL = "upstream-detail";

/** A cap no answer in these suites reaches. */
const ROOMY = 1_000_000;

function upstreamResponse(answer: ConformanceAnswer): Response {
  const headers = new Headers(answer.headers ?? {});
  headers.set(
    "content-type",
    headers.get("content-type") ?? "application/json",
  );
  return new Response(JSON.stringify(answer.json ?? {}), {
    status: answer.status ?? 200,
    headers,
  });
}

function recordingFetch(respond: (attempt: number) => Response) {
  const calls: RecordedUpstreamCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return respond(calls.length);
  };
  return { calls, fetcher };
}

export function describeProviderConformance(target: ConformanceTarget): void {
  const run = (
    respond: (attempt: number) => Response,
    options: {
      readonly retries?: number;
      readonly maxResponseBytes?: number;
    } = {},
  ) => {
    const { calls, fetcher } = recordingFetch(respond);
    const read = target.build({
      fetcher,
      retries: options.retries ?? 0,
      maxResponseBytes: options.maxResponseBytes ?? ROOMY,
    });
    return { calls, read };
  };

  const failure = async (
    read: () => Promise<unknown>,
  ): Promise<IntegrationError> => {
    const thrown = await read().then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(thrown, "the read must fail").toBeInstanceOf(IntegrationError);
    return thrown as IntegrationError;
  };

  describe(`${target.provider} conformance (${target.operation})`, () => {
    it("uses the declared method and refuses every redirect", async () => {
      const { calls, read } = run(() =>
        upstreamResponse({ json: target.answer }),
      );
      await read();
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.init.method).toBe(target.method);
        expect(call.init.redirect).toBe("error");
        // The deployment's own deadline travels with every attempt.
        expect(call.init.signal).toBeDefined();
      }
    });

    it("spends the secret in the declared carrier and nowhere else", async () => {
      const { calls, read } = run(() =>
        upstreamResponse({ json: target.answer }),
      );
      await read();
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        const headers = new Headers(call.init.headers);
        if (target.carrier.kind === "header") {
          expect(headers.get(target.carrier.name)).toBe(target.carrier.value);
        } else {
          expect(call.url.href).toContain(target.carrier.value);
        }
        for (const [name, value] of headers.entries()) {
          if (
            target.carrier.kind === "header" &&
            name.toLowerCase() === target.carrier.name
          ) {
            continue;
          }
          expect(value, `${name} carries the secret`).not.toContain(
            target.secret,
          );
        }
        if (target.carrier.kind === "header") {
          expect(call.url.href).not.toContain(target.secret);
        }
        expect(String(call.init.body ?? "")).not.toContain(target.secret);
      }
    });

    it("parses a body exactly at the cap and refuses one byte over it", async () => {
      const cap = Buffer.byteLength(
        JSON.stringify(target.answer ?? {}),
        "utf8",
      );

      const atCap = run(() => upstreamResponse({ json: target.answer }), {
        maxResponseBytes: cap,
      });
      await expect(atCap.read()).resolves.toBeDefined();

      const overCap = run(() => upstreamResponse({ json: target.answer }), {
        maxResponseBytes: cap - 1,
      });
      await expect(overCap.read()).rejects.toMatchObject({
        code: "ResultTooLarge",
      });

      // A declared size over the cap is too large without reading the body.
      const declared = run(
        () =>
          upstreamResponse({
            json: target.answer,
            headers: { "content-length": String(cap * 1_000) },
          }),
        { maxResponseBytes: cap },
      );
      await expect(declared.read()).rejects.toMatchObject({
        code: "ResultTooLarge",
      });
    });

    it("maps the statuses it names and keeps the upstream body out of them", async () => {
      for (const [status, code] of target.statuses) {
        const { read } = run(() =>
          upstreamResponse({
            status,
            json: { detail: `${UPSTREAM_DETAIL} ${target.secret}` },
          }),
        );
        const error = await failure(read);
        expect(error.code, `status ${status}`).toBe(code);
        expect(String(error.message), `status ${status}`).not.toContain(
          UPSTREAM_DETAIL,
        );
        expect(String(error.message), `status ${status}`).not.toContain(
          target.secret,
        );
      }
    });

    it("spends the declared attempts on a transient answer and none on a refusal", async () => {
      const { attempts, status, code } = target.transient;

      const persisting = run(
        () => upstreamResponse({ status, headers: { "retry-after": "0" } }),
        { retries: attempts - 1 },
      );
      const exhausted = await failure(persisting.read);
      expect(exhausted.code).toBe(code);
      expect(persisting.calls, "attempts").toHaveLength(attempts);

      if (attempts > 1) {
        const recovering = run(
          (attempt) =>
            attempt < attempts
              ? upstreamResponse({ status, headers: { "retry-after": "0" } })
              : upstreamResponse({ json: target.answer }),
          { retries: attempts - 1 },
        );
        await expect(recovering.read()).resolves.toBeDefined();
        expect(recovering.calls, "attempts").toHaveLength(attempts);
      }

      const refused = run(() => upstreamResponse({ status: 403 }), {
        retries: attempts - 1,
      });
      const denied = await failure(refused.read);
      expect(denied.code).toBe("ProviderPermissionDenied");
      expect(refused.calls, "a refusal is not retried").toHaveLength(1);
    });
  });
}
