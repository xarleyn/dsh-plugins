import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  parseAskBody,
  parseMultipart,
  QA_INTEGRATION_DEFAULT_TRANSCRIPT_LIMIT,
  QA_INTEGRATION_MAX_FILES,
  readBody,
  registerQaIntegrationRoutes,
} from "../../src/integration/http.js";
import { QA_INTEGRATION_MAX_TRANSCRIPT_MESSAGES } from "../../src/integration/transcript.js";
import { QaIntegrationError } from "../../src/integration/contract.js";
import type { QaAskRequest } from "../../src/integration/contract.js";
import type { QaIntegrationService } from "../../src/integration/service.js";
import { resolveConfig } from "../../src/resolve-config.js";

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
    expect(parsed.attachments[0]).toMatchObject({
      kind: "image",
      mediaType: "image/png",
      name: "screen.png",
    });
    const image = parsed.attachments[0];
    expect(
      Buffer.from(image?.kind === "image" ? image.data : "", "base64").toString(
        "binary",
      ),
    ).toBe("\u0089PNG");
  });

  it("carries a document as bytes for the Host to read", () => {
    const parsed = parseAskBody(
      multipart([
        { name: "message", value: "см. вложение" },
        {
          name: "files",
          value: "%PDF-1.4",
          filename: "Договор.pdf",
          contentType: "application/pdf",
        },
        {
          name: "files",
          value: "a;b\n1;2",
          filename: "table.csv",
          contentType: "text/csv",
        },
      ]),
      `multipart/form-data; boundary=${boundary}`,
      config,
    );
    expect(parsed.attachments).toHaveLength(2);
    const [document, table] = parsed.attachments;
    expect(document).toMatchObject({
      kind: "file",
      mediaType: "application/pdf",
      name: "Договор.pdf",
    });
    expect(document?.kind === "file" ? document.bytes.toString() : "").toBe(
      "%PDF-1.4",
    );
    expect(table).toMatchObject({
      kind: "file",
      mediaType: "text/csv",
      name: "table.csv",
    });
  });

  it("refuses a format no reader can open with the bridge's own fallback", () => {
    for (const [filename, contentType] of [
      ["dump.zip", "application/zip"],
      ["tool.exe", "application/octet-stream"],
      ["clip.mp4", "video/mp4"],
      ["logo.svg", "image/svg+xml"],
    ]) {
      const refusal = expectRefusal(() =>
        parseAskBody(
          multipart([
            { name: "message", value: "см. вложение" },
            {
              name: "files",
              value: "binary",
              filename: filename ?? "x",
              contentType: contentType ?? "application/octet-stream",
            },
          ]),
          `multipart/form-data; boundary=${boundary}`,
          config,
        ),
      );
      expect(refusal.reason).toBe("unsupported-media");
      expect(refusal.status).toBe(415);
    }
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

  it("reads an extended filename, so a non-ASCII attachment stays a file", () => {
    // Browsers and several HTTP clients send a non-ASCII name in the RFC 5987
    // form, where the plain parameter is absent. Read as a text field, the part
    // would be dropped and the question answered without its attachment.
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="message"\r\n\r\n` +
          "hi\r\n" +
          `--${boundary}\r\ncontent-disposition: form-data; name="files"; ` +
          "filename*=UTF-8''%D0%94%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80.pdf" +
          "\r\ncontent-type: application/pdf\r\n\r\n%PDF\r\n",
      ),
      Buffer.from(`--${boundary}--\r\n`),
    ]);
    const parsed = parseAskBody(
      body,
      `multipart/form-data; boundary=${boundary}`,
      config,
    );
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      kind: "file",
      mediaType: "application/pdf",
      name: "Договор.pdf",
    });
  });

  it("refuses a part without its header separator instead of dropping it", () => {
    // Skipping such a part is how an attachment disappears silently — the one
    // outcome the contract refuses to answer around.
    const body = Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="message"\r\n\r\n` +
        `hi\r\n--${boundary}\r\nnot a header line\r\n--${boundary}--\r\n`,
    );
    expect(
      expectRefusal(() =>
        parseAskBody(body, `multipart/form-data; boundary=${boundary}`, config),
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

  it("removes every route when disposed", () => {
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
    expect(register).toHaveBeenCalledTimes(3);
    dispose();
    const removers = register.mock.results.map((result) => result.value);
    for (const remover of removers) expect(remover).toHaveBeenCalledOnce();
  });
});

/** A request whose URL carries the query the session route reads. */
function sessionRequest(url: string, method = "GET"): IncomingMessage {
  const request = Readable.from([]) as unknown as IncomingMessage;
  request.method = method;
  request.headers = { authorization: "Bearer qsat.x.y" };
  request.url = url;
  return request;
}

describe("integration session route", () => {
  const transcript = {
    chatId: "session-1",
    messages: [
      { seq: 1, role: "user" as const, text: "вопрос" },
      {
        seq: 2,
        role: "assistant" as const,
        text: "ответ",
        at: "2026-09-21T10:00:00.000Z",
      },
    ],
    lastSeq: 2,
    truncated: false,
  };

  it("serves the transcript in the bridge's own field names", async () => {
    const session = vi.fn(async () => transcript);
    const { at } = harness({ session: session as never });
    const { response, state } = fakeResponse();
    await at("/qa/api/session")?.handler(
      sessionRequest("/qa/api/session?chat_id=session-1&after=0&limit=10"),
      response,
    );
    expect(state.status).toBe(200);
    expect(state.headers["cache-control"]).toBe("no-store");
    // A message the log gave no time gets `null` rather than a missing field:
    // the bridge reads one message shape, and absence is its own bug there.
    expect(JSON.parse(state.body)).toEqual({
      chat_id: "session-1",
      messages: [
        { seq: 1, role: "user", text: "вопрос", at: null },
        {
          seq: 2,
          role: "assistant",
          text: "ответ",
          at: "2026-09-21T10:00:00.000Z",
        },
      ],
      last_seq: 2,
      truncated: false,
    });
    expect(session).toHaveBeenCalledWith("Bearer qsat.x.y", {
      chatId: "session-1",
      after: 0,
      limit: 10,
    });
  });

  it("defaults the page size and clamps one past the ceiling", async () => {
    const session = vi.fn(async () => transcript);
    const { at } = harness({ session: session as never });
    await at("/qa/api/session")?.handler(
      sessionRequest("/qa/api/session?chat_id=session-1"),
      fakeResponse().response,
    );
    // A caller that asks for no page still gets one, so the answer has the
    // same shape either way.
    expect(session).toHaveBeenLastCalledWith("Bearer qsat.x.y", {
      chatId: "session-1",
      after: 0,
      limit: QA_INTEGRATION_DEFAULT_TRANSCRIPT_LIMIT,
    });
    // A page size is a preference: more than the ceiling is served at the
    // ceiling, because the window is still an answer and only shorter.
    await at("/qa/api/session")?.handler(
      sessionRequest("/qa/api/session?chat_id=session-1&limit=9999"),
      fakeResponse().response,
    );
    expect(session).toHaveBeenLastCalledWith("Bearer qsat.x.y", {
      chatId: "session-1",
      after: 0,
      limit: QA_INTEGRATION_MAX_TRANSCRIPT_MESSAGES,
    });
  });

  it("decodes an escaped chat id and honours the caller's cursor", async () => {
    const session = vi.fn(async () => transcript);
    const { at } = harness({ session: session as never });
    await at("/qa/api/session")?.handler(
      sessionRequest("/qa/api/session?chat_id=chat%3A1&after=41"),
      fakeResponse().response,
    );
    expect(session).toHaveBeenCalledWith("Bearer qsat.x.y", {
      chatId: "chat:1",
      after: 41,
      limit: QA_INTEGRATION_DEFAULT_TRANSCRIPT_LIMIT,
    });
  });

  it("refuses a missing chat id, a negative cursor and a page of zero", async () => {
    const session = vi.fn(async () => transcript);
    const { at } = harness({ session: session as never });
    for (const url of [
      "/qa/api/session",
      "/qa/api/session?chat_id=%20",
      "/qa/api/session?chat_id=session-1&after=-1",
      "/qa/api/session?chat_id=session-1&after=abc",
      "/qa/api/session?chat_id=session-1&limit=0",
      "/qa/api/session?chat_id=session-1&limit=1.5",
    ]) {
      const { response, state } = fakeResponse();
      await at("/qa/api/session")?.handler(sessionRequest(url), response);
      expect(state.status).toBe(400);
      expect(JSON.parse(state.body).code).toBe("invalid-request");
    }
    // A cursor the caller did not mean is refused before the log is opened: no
    // page is read for it.
    expect(session).not.toHaveBeenCalled();
  });

  it("answers a wrong method with 405 and the allowed verbs", async () => {
    const { at } = harness({ session: vi.fn() });
    const { response, state } = fakeResponse();
    await at("/qa/api/session")?.handler(
      sessionRequest("/qa/api/session?chat_id=session-1", "POST"),
      response,
    );
    expect(state.status).toBe(405);
    expect(state.headers.allow).toBe("GET, HEAD");
  });

  it("maps a refusal onto its status without leaking the credential", async () => {
    const { at } = harness({
      session: vi.fn(async () => {
        throw new QaIntegrationError("not-found", "no such conversation");
      }) as never,
    });
    const { response, state } = fakeResponse();
    await at("/qa/api/session")?.handler(
      sessionRequest("/qa/api/session?chat_id=session-1"),
      response,
    );
    expect(state.status).toBe(404);
    expect(JSON.parse(state.body)).toEqual({
      error: "no such conversation",
      code: "not-found",
    });
    expect(state.body).not.toContain("qsat");
  });
});
