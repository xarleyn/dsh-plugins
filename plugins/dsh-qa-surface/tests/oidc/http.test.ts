import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerQaOidcRoute } from "../../src/oidc/http.js";
import { resolveConfig } from "../../src/resolve-config.js";
import type { QaOidcService } from "../../src/oidc/service.js";

describe("QA OIDC callback route", () => {
  const config = resolveConfig({
    accounts: {
      enabled: true,
      oidc: {
        enabled: true,
        issuer: "https://id.example.corp/realms/demo",
        clientId: "qa-surface",
        redirectUri: "https://qa.example.corp/qa/oidc/callback",
      },
    },
  });
  function fixture(
    callback = vi.fn(
      async () => "https://qa.example.corp/qa#qa-oidc=synthetic-handoff",
    ),
  ) {
    let handler: (
      request: IncomingMessage,
      response: ServerResponse,
    ) => Promise<void>;
    const dispose = vi.fn();
    const register = vi.fn((route) => {
      handler = route.handler;
      return dispose;
    });
    const unregister = registerQaOidcRoute({ register } as never, config, {
      callback,
    } as unknown as QaOidcService);
    const response = { writeHead: vi.fn(), end: vi.fn() };
    return {
      register,
      callback,
      response,
      dispose,
      unregister,
      run: (method: string) =>
        handler(
          {
            method,
            url: "/qa/oidc/callback?code=synthetic-code",
          } as IncomingMessage,
          response as never,
        ),
    };
  }
  it("registers an exact callback, redirects without caching, and releases the route", async () => {
    const f = fixture();
    await f.run("GET");
    expect(f.register).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "exact", path: "/qa/oidc/callback" }),
    );
    expect(f.response.writeHead).toHaveBeenCalledWith(
      302,
      expect.objectContaining({
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        location: "https://qa.example.corp/qa#qa-oidc=synthetic-handoff",
      }),
    );
    f.unregister();
    expect(f.dispose).toHaveBeenCalledOnce();
  });
  it("rejects non-GET requests before protocol processing", async () => {
    const f = fixture();
    await f.run("POST");
    expect(f.callback).not.toHaveBeenCalled();
    expect(f.response.writeHead).toHaveBeenCalledWith(
      405,
      expect.objectContaining({ allow: "GET" }),
    );
  });
  it("does not disclose provider error details or token material", async () => {
    const f = fixture(
      vi.fn(async () => {
        throw new Error("synthetic-provider-secret");
      }),
    );
    await f.run("GET");
    expect(f.response.writeHead).toHaveBeenCalledWith(
      400,
      expect.objectContaining({ "cache-control": "no-store" }),
    );
    expect(f.response.end.mock.calls.flat().join()).not.toContain(
      "synthetic-provider-secret",
    );
  });
});
