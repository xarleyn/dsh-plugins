import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { vi, type Mock } from "vitest";
import type { ToolDeps } from "../src/tools.js";
import { HumanizerClient } from "../src/client.js";
import { resolveConfig, type HumanizerConfig } from "../src/config.js";

export function execution(
  signal = new AbortController().signal,
): ToolRunContext {
  return { signal } as ToolRunContext;
}
export type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: Record<string, unknown>,
) => void;
export async function server(handler: Handler) {
  const requests: {
    path: string;
    body: Record<string, unknown>;
    authorization: string | undefined;
  }[] = [];
  const instance = createServer((request, response) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (part: string) => {
      data += part;
    });
    request.on("end", () => {
      const body = data ? (JSON.parse(data) as Record<string, unknown>) : {};
      requests.push({
        path: request.url ?? "",
        body,
        authorization: request.headers.authorization,
      });
      handler(request, response, body);
    });
  });
  await new Promise<void>((resolve) =>
    instance.listen(0, "127.0.0.1", resolve),
  );
  const address = instance.address();
  if (!address || typeof address === "string")
    throw new Error("test server has no port");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        instance.close((error) => (error ? reject(error) : resolve()));
        instance.closeAllConnections();
      }),
  };
}

export function json(response: ServerResponse, data: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(data));
}

export function normal(
  request: IncomingMessage,
  response: ServerResponse,
  body: Record<string, unknown>,
) {
  switch (request.url) {
    case "/health":
      json(response, { status: "ok" });
      break;
    case "/props":
      json(response, {
        default_generation_settings: { n_ctx: 8192 },
        model_path: "/private/model/file.gguf",
      });
      break;
    case "/tokenize":
      json(response, { tokens: [1, 2, 3] });
      break;
    case "/completion":
      json(response, {
        content: String(body["prompt"])
          .split("\n\n### Rewritten:")[0]!
          .split("\n\n")
          .slice(3)
          .join("\n\n"),
        stop_type: "eos",
        truncated: false,
      });
      break;
    default:
      json(response, {}, 404);
  }
}

export function dependencies(
  endpoint: string,
  config: HumanizerConfig = {},
): ToolDeps & {
  controller: AbortController;
  logger: { debug: Mock; info: Mock; warn: Mock; error: Mock };
} {
  const resolved = resolveConfig({ endpoint, ...config });
  const lifecycle = new AbortController();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    config: resolved,
    client: new HumanizerClient(resolved),
    lifecycle: lifecycle.signal,
    controller: lifecycle,
    logger,
  };
}
