import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import {
  installQaNativeFence,
  qaNativeEndpointDenied,
} from "../../src/chat-sharing/native-fence.js";
describe("native operator boundary in accounts mode", () => {
  it("admits tokenized browser panel methods while new and native browser methods stay closed", () => {
    for (const method of [
      "panelState",
      "panelFrame",
      "panelTakeControl",
      "panelControlHeartbeat",
      "panelReleaseControl",
      "panelSelectTab",
      "panelNavigate",
      "panelPointer",
      "panelKey",
      "panelText",
      "panelScroll",
      "panelNewTab",
      "panelCloseTab",
      "panelHistory",
      "panelViewport",
    ]) {
      expect(qaNativeEndpointDenied(`qaBrowser/${method}`)).toBe(false);
    }
    for (const method of [
      "newOperatorMethod",
      "navigate",
      "listTabs",
      "ensureSession",
    ]) {
      expect(qaNativeEndpointDenied(`qaBrowser/${method}`)).toBe(true);
    }
  });
  it("keeps token-authenticated personal integration cards and fails closed for new methods", () => {
    expect(qaNativeEndpointDenied("qaIntegrations/getGitlab")).toBe(false);
    expect(qaNativeEndpointDenied("qaIntegrations/credentialSource")).toBe(
      false,
    );
    expect(qaNativeEndpointDenied("qaIntegrations/newOperatorMethod")).toBe(
      true,
    );
  });
  it.each([
    "session/page",
    "session/follow",
    "session/prompt",
    "session/fork",
    "session/attachment",
    "subagents/prompt",
    "agentPresets/select",
    "fileUploads/upload",
    "file",
    "tools/execute",
    "unknown/read",
    "%73ession/page",
    "$events/result",
  ])("refuses %s", (endpoint) => {
    expect(qaNativeEndpointDenied(endpoint)).toBe(true);
  });
  it("fences direct Gateway, wire streams, mounted HTTP and Host-wide notifications", async () => {
    let active = true;
    const invoke = vi.fn(async (_request: unknown) => "native-value"),
      stream = vi.fn(async (_request: unknown) => []);
    const open = vi.fn(async (_endpoint: string) =>
      (async function* () {
        yield {
          type: "ready",
          clientId: "synthetic-client",
          host: { home: "/operator-home" },
        };
        yield {
          type: "emit",
          event: "api-session/added",
          args: [{ sessionId: "private-chat" }],
        };
        yield {
          type: "waterfall",
          event: "tools/pre-execute",
          agentId: "private-chat",
        };
      })(),
    );
    const gateway = { invoke, stream, wireStream: { open } };
    let http: (
      request: unknown,
      response: unknown,
      next: () => Promise<void>,
    ) => Promise<void> = async () => {};
    const ctx = {
      get: (name: string) => (name === "typertGateway" ? gateway : undefined),
      on: (_event: string, listener: typeof http) => {
        http = listener;
        return vi.fn();
      },
    } as unknown as Context;
    const restore = installQaNativeFence(ctx, () => active);
    await expect(
      gateway.invoke({
        namespace: "session",
        method: "page",
        args: {},
      } as never),
    ).rejects.toThrow("QA");
    await expect(
      gateway.stream({
        namespace: "session",
        method: "follow",
        args: {},
      } as never),
    ).rejects.toThrow("QA");
    await expect(
      gateway.wireStream.open("session/follow" as never),
    ).rejects.toThrow("QA");
    const safe = await gateway.wireStream.open("$events" as never);
    const frames = [];
    for await (const frame of safe) frames.push(frame);
    expect(frames).toEqual([
      { type: "ready", clientId: "synthetic-client", host: { home: "" } },
    ]);
    const response = { writeHead: vi.fn(), end: vi.fn() };
    const next = vi.fn(async () => {});
    await http({ url: "/qa/api/%73ession/page" }, response, next);
    expect(response.writeHead).toHaveBeenCalledWith(403, expect.anything());
    expect(next).not.toHaveBeenCalled();
    await http({ url: "/qa/api/qaSurface/chatPage" }, response, next);
    expect(next).toHaveBeenCalledOnce();
    active = false;
    await expect(
      gateway.invoke({
        namespace: "session",
        method: "page",
        args: {},
      } as never),
    ).resolves.toBe("native-value");
    restore();
    expect(gateway.invoke).toBe(invoke);
    expect(gateway.wireStream.open).toBe(open);
  });
  it("admits only Connection-attested operator peers and HTTP requests", async () => {
    const operator = {};
    const client = {};
    const invoke = vi.fn(async (_request: unknown) => "operator-value");
    const stream = vi.fn(async (_request: unknown) => []);
    const open = vi.fn(
      async (
        _endpoint: unknown,
        _payload?: unknown,
        _uplink?: unknown,
        _peer?: unknown,
      ) =>
        (async function* () {
          yield { type: "emit", event: "api-session/added", args: [] };
        })(),
    );
    const gateway = { invoke, stream, wireStream: { open } };
    let http = async (
      _request: unknown,
      _response: unknown,
      _next: () => Promise<void>,
    ) => {};
    const trustedRequest = { url: "/api/session/page" };
    const ctx = {
      get: (name: string) =>
        name === "typertGateway"
          ? gateway
          : {
              isOperatorPeer: (peer: unknown) => peer === operator,
              isOperatorRequest: (request: unknown) =>
                request === trustedRequest,
            },
      on: (_event: string, listener: typeof http) => {
        http = listener;
        return vi.fn();
      },
    } as unknown as Context;
    const restore = installQaNativeFence(ctx, () => true);
    const request = {
      namespace: "session",
      method: "page",
      args: {},
      peer: operator,
    };
    await expect(gateway.invoke(request as never)).resolves.toBe(
      "operator-value",
    );
    await expect(gateway.stream(request as never)).resolves.toEqual([]);
    for (const peer of [client, { role: "operator" }, undefined]) {
      await expect(
        gateway.invoke({ ...request, peer } as never),
      ).rejects.toThrow("QA");
      await expect(
        gateway.wireStream.open(
          "session/follow" as never,
          {} as never,
          undefined as never,
          peer as never,
        ),
      ).rejects.toThrow("QA");
    }
    const frames = [];
    for await (const frame of await gateway.wireStream.open(
      "$events" as never,
      {} as never,
      undefined as never,
      operator as never,
    ))
      frames.push(frame);
    expect(frames).toHaveLength(1);
    const next = vi.fn(async () => {});
    const response = { writeHead: vi.fn(), end: vi.fn() };
    await http(trustedRequest, response, next);
    expect(next).toHaveBeenCalledOnce();
    await http(
      { ...trustedRequest, headers: { "x-role": "operator" } },
      response,
      next,
    );
    expect(response.writeHead).toHaveBeenCalledWith(403, expect.anything());
    expect(next).toHaveBeenCalledOnce();
    restore();
  });
});
