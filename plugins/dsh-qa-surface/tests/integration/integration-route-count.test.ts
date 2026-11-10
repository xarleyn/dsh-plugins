import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { QaSurface } from "../../src/index.js";
import { resolveConfig } from "../../src/resolve-config.js";

it("applies changed inherited and explicit file limits to the next HTTP request", async () => {
  type Route = {
    path: string;
    handler(req: IncomingMessage, res: ServerResponse): unknown;
  };
  const routes = new Map<string, Route>();
  let config = resolveConfig({
    accounts: { enabled: true },
    attachments: { maxPending: 10 },
    integration: { enabled: true },
  });
  const surface = Object.create(QaSurface.prototype) as QaSurface;
  Object.assign(surface, {
    getConfig: () => config,
    webServer: {
      register: (route: Route) => {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    integration: { ask: vi.fn() },
    logger: { info: vi.fn(), error: vi.fn() },
  });
  const refresh = () =>
    (
      surface as unknown as { refreshIntegrationRoutes(): void }
    ).refreshIntegrationRoutes();
  const request = async (count: number) => {
    const boundary = "count-check";
    const body =
      Array.from(
        { length: count },
        (_, i) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="image-${String(i)}.png"\r\nContent-Type: image/png\r\n\r\nx\r\n`,
      ).join("") + `--${boundary}--\r\n`;
    const req = Readable.from([
      Buffer.from(body),
    ]) as unknown as IncomingMessage;
    Object.assign(req, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    let status = 0,
      reply = "";
    const response = {
      writeHead(code: number) {
        status = code;
      },
      end(value: string) {
        reply = value;
      },
    } as ServerResponse;
    await routes.get("/qa/api/ask")!.handler(req, response);
    expect(status).toBe(400);
    return JSON.parse(reply) as { error: string };
  };
  refresh();
  expect((await request(11)).error).toContain("at most 10");
  config = resolveConfig({
    accounts: { enabled: true },
    attachments: { maxPending: 15 },
    integration: { enabled: true },
  });
  refresh();
  expect((await request(15)).error).toBe("message is required");
  expect((await request(16)).error).toContain("at most 15");
  config = resolveConfig({
    accounts: { enabled: true },
    attachments: { maxPending: 15 },
    integration: { enabled: true, maxAttachments: 3 },
  });
  refresh();
  expect((await request(4)).error).toContain("at most 3");
});
