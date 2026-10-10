import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { installQaNativeFence, qaNativeEndpointDenied } from "../../src/chat-sharing/native-fence.js";
describe("native operator boundary in accounts mode", () => {
  it("keeps token-authenticated personal integration cards and fails closed for new methods", () => {
    expect(qaNativeEndpointDenied("qaIntegrations/getGitlab")).toBe(false);
    expect(qaNativeEndpointDenied("qaIntegrations/credentialSource")).toBe(false);
    expect(qaNativeEndpointDenied("qaIntegrations/newOperatorMethod")).toBe(true);
  });
  it.each(["session/page", "session/follow", "session/prompt", "session/fork", "session/attachment", "subagents/prompt",
    "agentPresets/select", "fileUploads/upload", "file", "tools/execute", "unknown/read", "%73ession/page", "$events/result"])("refuses %s", endpoint => {
    expect(qaNativeEndpointDenied(endpoint)).toBe(true);
  });
  it("fences direct Gateway, wire streams, mounted HTTP and Host-wide notifications", async () => {
    let active = true;
    const invoke = vi.fn(async (_request: unknown) => "native-value"), stream = vi.fn(async (_request: unknown) => []);
    const open = vi.fn(async (_endpoint: string) => (async function*() {
      yield { type: "ready", clientId: "synthetic-client", host: { home: "/operator-home" } };
      yield { type: "emit", event: "api-session/added", args: [{ sessionId: "private-chat" }] };
      yield { type: "waterfall", event: "tools/pre-execute", agentId: "private-chat" };
    })());
    const gateway = { invoke, stream, wireStream: { open } };
    let http: (request: unknown, response: unknown, next: () => Promise<void>) => Promise<void> = async () => {};
    const ctx = { get: () => gateway, on: (_event: string, listener: typeof http) => { http = listener; return vi.fn(); } } as unknown as Context;
    const restore = installQaNativeFence(ctx, () => active);
    await expect(gateway.invoke({ namespace: "session", method: "page", args: {} } as never)).rejects.toThrow("QA");
    await expect(gateway.stream({ namespace: "session", method: "follow", args: {} } as never)).rejects.toThrow("QA");
    await expect(gateway.wireStream.open("session/follow" as never)).rejects.toThrow("QA");
    const safe = await gateway.wireStream.open("$events" as never);
    const frames = []; for await (const frame of safe) frames.push(frame);
    expect(frames).toEqual([{ type: "ready", clientId: "synthetic-client", host: { home: "" } }]);
    const response = { writeHead: vi.fn(), end: vi.fn() }; const next = vi.fn(async () => {});
    await http({ url: "/qa/api/%73ession/page" }, response, next);
    expect(response.writeHead).toHaveBeenCalledWith(403, expect.anything()); expect(next).not.toHaveBeenCalled();
    await http({ url: "/qa/api/qaSurface/chatPage" }, response, next); expect(next).toHaveBeenCalledOnce();
    active = false;
    await expect(gateway.invoke({ namespace: "session", method: "page", args: {} } as never)).resolves.toBe("native-value");
    restore(); expect(gateway.invoke).toBe(invoke); expect(gateway.wireStream.open).toBe(open);
  });
});
