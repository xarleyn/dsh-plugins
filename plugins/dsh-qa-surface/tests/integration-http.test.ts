import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  parseAskBody,
  parseMultipart,
  QA_INTEGRATION_MAX_FILES,
  readBody,
  registerQaIntegrationRoutes,
} from "../src/integration/http.js";
import { QaIntegrationError } from "../src/integration/contract.js";
import type { QaAskRequest } from "../src/integration/contract.js";
import type { QaIntegrationService } from "../src/integration/service.js";
import { resolveConfig } from "../src/resolve-config.js";

/**
 * The integration API's transport: encodings, size ceilings, method handling
 * and the status code each refusal turns into. The service is faked here — who
 * may ask is the service's business, and this file is about bytes.
 */

const config = resolveConfig({
  accounts: { enabled: true },
  integration: { enabled: true },
});

function body(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function expectRefusal(run: () => unknown): QaIntegrationError {
  try {
    run();
  } catch (error) {
    if (error instanceof QaIntegrationError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("integration ask body parsing", () => {
  it("reads the JSON encoding the bridge sends", () => {
    const parsed = parseAskBody(
      body({
        message: "TEST получения задач для ИИ Агента",
        version: "3.8",
        session_id: null,
        context: {
          ticket_key: "PROJ-456",
          reporter: "user@example.corp",
          reporter_name: "Иван Иванов",
        },
        ignored: true,
      }),
      "application/json; charset=utf-8",
      config,
    );
    expect(parsed.message).toBe("TEST получения задач для ИИ Агента");
    expect(parsed.version).toBe("3.8");
    expect(parsed.sessionId).toBeNull();
    expect(parsed.context.ticketKey).toBe("PROJ-456");
    expect(parsed.attachments).toEqual([]);
  });

  it("refuses a body without a message and a body that is not JSON", () => {
    expect(
      expectRefusal(() =>
        parseAskBody(body({ version: "3.8" }), "application/json", config),
      ).reason,
    ).toBe("invalid-request");
    expect(
      expectRefusal(() =>
        parseAskBody(body({ message: "   " }), "application/json", config),
      ).reason,
    ).toBe("invalid-request");
    expect(
      expectRefusal(() =>
        parseAskBody(Buffer.from("{ not json"), "application/json", config),
      ).reason,
    ).toBe("invalid-request");
  });

  it("accepts a JSON request with no content type at all", () => {
    // Behind a proxy that strips the header the body is still JSON; refusing
    // it would be a deployment-shaped outage, not a safety property.
    const parsed = parseAskBody(body({ message: "hi" }), undefined, config);
    expect(parsed.message).toBe("hi");
  });

  it("refuses an encoding it does not speak", () => {
    const refusal = expectRefusal(() =>
      parseAskBody(
        Buffer.from("message=hi"),
        "application/x-www-form-urlencoded",
        config,
      ),
    );
    expect(refusal.reason).toBe("unsupported-media");
    expect(refusal.status).toBe(415);
  });
});

describe("integration multipart parsing", () => {
  const boundary = "----dshBoundary";

  function multipart(
    parts: readonly {
      readonly name: string;
      readonly value: string;
      readonly filename?: string;
      readonly contentType?: string;
    }[],
  ): Buffer {
    const chunks: Buffer[] = [];
    for (const part of parts) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\ncontent-disposition: form-data; name="${part.name}"` +
            (part.filename === undefined
              ? ""
              : `; filename="${part.filename}"`) +
            `\r\ncontent-type: ${part.contentType ?? "text/plain"}\r\n\r\n`,
        ),
      );
      chunks.push(
        part.filename === undefined
          ? Buffer.from(part.value)
          : Buffer.from(part.value, "binary"),
      );
      chunks.push(Buffer.from("\r\n"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
  }

  it("reads the text fields, the JSON-string context and an inline image", () => {
    const parsed = parseAskBody(
      multipart([
        { name: "message", value: "Компоненты: MDC" },
        { name: "version", value: "" },
        { name: "session_id", value: "" },
        {
          name: "context",
          value: JSON.stringify({
            ticket_key: "PROJ-123",
            reporter: "a@b.corp",
          }),
        },
        {
          name: "files",
          value: "\u0089PNG",
          filename: "screen.png",
          contentType: "image/png",
        },
      ]),
      `multipart/form-data; boundary=${boundary}`,
      config,
    );
    expect(parsed.message).toBe("Компоненты: MDC");
    expect(parsed.version).toBeNull();
    expect(parsed.sessionId).toBeNull();
    expect(parsed.context.ticketKey).toBe("PROJ-123");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.mediaType).toBe("image/png");
    expect(parsed.attachments[0]?.name).toBe("screen.png");
    expect(
      Buffer.from(parsed.attachments[0]?.data ?? "", "base64").toString(
        "binary",
      ),
    ).toBe("\u0089PNG");
  });

  it("refuses a non-image attachment with the fallback the bridge waits for", () => {
    const refusal = expectRefusal(() =>
      parseAskBody(
        multipart([
          { name: "message", value: "см. вложение" },
          {
            name: "files",
            value: "%PDF-1.4",
            filename: "doc.pdf",
            contentType: "application/pdf",
          },
        ]),
        `multipart/form-data; boundary=${boundary}`,
        config,
      ),
    );
    expect(refusal.reason).toBe("unsupported-media");
    expect(refusal.status).toBe(415);
  });

  it("refuses a multipart request without a boundary and a malformed one", () => {
    expect(
      expectRefusal(() =>
        parseAskBody(Buffer.from("x"), "multipart/form-data", config),
      ).reason,
    ).toBe("invalid-request");
    expect(
      expectRefusal(() =>
        parseMultipart(Buffer.from("no boundary here"), "xyz"),
      ).reason,
    ).toBe("invalid-request");
  });

  it("bounds the number of attachments and their size", () => {
    const many = Array.from(
      { length: QA_INTEGRATION_MAX_FILES + 1 },
      (_, index) => ({
        name: "files",
        value: "x",
        filename: `file-${String(index)}.png`,
        contentType: "image/png",
      }),
    );
    expect(
      expectRefusal(() => parseMultipart(multipart(many), boundary)).reason,
    ).toBe("invalid-request");

    const tight = resolveConfig({
      accounts: { enabled: true },
      integration: { enabled: true, maxAttachmentBytes: 1024 },
    });
    expect(
      expectRefusal(() =>
        parseAskBody(
          multipart([
            { name: "message", value: "hi" },
            {
              name: "files",
              value: "x".repeat(2048),
              filename: "big.png",
              contentType: "image/png",
            },
          ]),
          `multipart/form-data; boundary=${boundary}`,
          tight,
        ),
      ).reason,
    ).toBe("payload-too-large");
  });

  it("refuses a context field that is not a JSON object", () => {
    expect(
      expectRefusal(() =>
        parseAskBody(
          multipart([
            { name: "message", value: "hi" },
            { name: "context", value: "not json" },
          ]),
          `multipart/form-data; boundary=${boundary}`,
          config,
        ),
      ).reason,
    ).toBe("invalid-request");
  });
});

describe("integration body ceiling", () => {
  function request(contents: string): IncomingMessage {
    return Readable.from([Buffer.from(contents)]) as unknown as IncomingMessage;
  }

  it("reads a body inside the limit", async () => {
    const read = await readBody(request("hello"), 1024);
    expect(read.toString("utf8")).toBe("hello");
  });

  it("refuses a body past the limit, whether declared or discovered", async () => {
    await expect(readBody(request("x".repeat(50)), 10)).rejects.toThrow(
      /larger than/,
    );
    const declared = Readable.from([]) as unknown as IncomingMessage;
    declared.headers = { "content-length": "999999" };
    await expect(readBody(declared, 10)).rejects.toThrow(/larger than/);
  });
});

/** A response stand-in that records what the route wrote. */
function fakeResponse() {
  const state = {
    status: 0,
    headers: {} as Record<string, string>,
    body: "",
    writableFinished: false,
  };
  const response = {
    writeHead: (status: number, headers: Record<string, string>) => {
      state.status = status;
      state.headers = headers;
    },
    end: (chunk?: Buffer | string) => {
      state.body = chunk === undefined ? "" : chunk.toString();
      state.writableFinished = true;
    },
    once: () => response,
    on: () => response,
  } as unknown as ServerResponse;
  return { response, state };
}

function fakeRequest(input: {
  readonly method: string;
  readonly headers?: Record<string, string>;
  readonly payload?: unknown;
}): IncomingMessage {
  const stream = Readable.from([
    Buffer.from(JSON.stringify(input.payload ?? {}), "utf8"),
  ]) as unknown as IncomingMessage;
  stream.method = input.method;
  stream.headers = input.headers ?? {};
  return stream;
}

function harness(service: Partial<QaIntegrationService>) {
  const routes: {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => unknown;
  }[] = [];
  const dispose = registerQaIntegrationRoutes(
    {
      register: (route: unknown) => {
        routes.push(route as never);
        return vi.fn();
      },
    } as never,
    {
      config,
      service: service as QaIntegrationService,
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
        close() {},
      } as never,
    },
  );
  const at = (path: string) => routes.find((route) => route.path === path);
  return { routes, dispose, at };
}

describe("integration routes", () => {
  it("serves the ask endpoint the way the bridge reads it", async () => {
    const ask = vi.fn(async () => ({
      chatId: "session-1",
      answer: "**Ответ**",
      sources: ["doc.pdf#стр.12"],
      confidence: "medium" as const,
      escalate: false,
      reason: "",
    }));
    const { at } = harness({ ask });
    const { response, state } = fakeResponse();
    await at("/qa/api/ask")?.handler(
      fakeRequest({
        method: "POST",
        headers: {
          authorization: "Bearer qsat.x.y",
          "content-type": "application/json",
        },
        payload: { message: "вопрос" },
      }),
      response,
    );
    expect(state.status).toBe(200);
    expect(state.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(state.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(state.body)).toEqual({
      chat_id: "session-1",
      answer: "**Ответ**",
      sources: ["doc.pdf#стр.12"],
      confidence: "medium",
      escalate: false,
      reason: "",
    });
    const [token, parsed] = ask.mock.calls[0] as unknown as [
      string,
      QaAskRequest,
    ];
    expect(token).toBe("Bearer qsat.x.y");
    expect(parsed.message).toBe("вопрос");
  });

  it("maps a refusal onto its status and never leaks the token", async () => {
    const { at } = harness({
      ask: vi.fn(async () => {
        throw new QaIntegrationError(
          "unauthorized",
          "the token is not accepted",
        );
      }),
    });
    const { response, state } = fakeResponse();
    await at("/qa/api/ask")?.handler(
      fakeRequest({
        method: "POST",
        headers: {
          authorization: "Bearer qsat.secret.value",
          "content-type": "application/json",
        },
        payload: { message: "вопрос" },
      }),
      response,
    );
    expect(state.status).toBe(401);
    expect(JSON.parse(state.body)).toEqual({
      error: "the token is not accepted",
      code: "unauthorized",
    });
    expect(state.body).not.toContain("secret");
  });

  it("answers a wrong method with 405 and the allowed verbs", async () => {
    const { at } = harness({ ask: vi.fn() });
    const { response, state } = fakeResponse();
    at("/qa/api/ask")?.handler(fakeRequest({ method: "GET" }), response);
    expect(state.status).toBe(405);
    expect(state.headers.allow).toBe("POST");
  });

  it("serves health in the bridge's own field names", async () => {
    const { at } = harness({
      health: vi.fn(async () => ({
        ok: true,
        version: "0.10.0",
        models: ["gpt-4o-mini"],
        uptimeS: 86400,
      })),
    });
    const { response, state } = fakeResponse();
    await at("/qa/api/health")?.handler(
      fakeRequest({
        method: "GET",
        headers: { authorization: "Bearer qsat.x.y" },
      }),
      response,
    );
    expect(state.status).toBe(200);
    expect(JSON.parse(state.body)).toEqual({
      ok: true,
      version: "0.10.0",
      models: ["gpt-4o-mini"],
      uptime_s: 86400,
    });
  });

  it("removes both routes when disposed", () => {
    const register = vi.fn(() => vi.fn());
    const dispose = registerQaIntegrationRoutes({ register } as never, {
      config,
      service: {} as QaIntegrationService,
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
        close() {},
      } as never,
    });
    expect(register).toHaveBeenCalledTimes(2);
    dispose();
    const removers = register.mock.results.map((result) => result.value);
    for (const remover of removers) expect(remover).toHaveBeenCalledOnce();
  });
});
