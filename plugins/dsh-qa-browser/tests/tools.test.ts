import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";

import type { QaBrowserService } from "../src/host/service.js";
import {
  BROWSER_CORE_TOOL_NAMES,
  BROWSER_VISION_TOOL_NAMES,
  createBrowserCoreTools,
  createBrowserVisionTools,
} from "../src/host/tools/index.js";

function execution(): ToolRunContext {
  return {
    name: "browser_type",
    arguments: {},
    signal: new AbortController().signal,
    callId: "call_test" as never,
    rootCallId: "call_test" as never,
    token: "token_test" as never,
    agent: {
      session: { id: "session-test" },
    } as never,
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  };
}

describe("Browser tool contract", () => {
  it("registers the focused Phase-A tool set", () => {
    const tools = createBrowserCoreTools({} as QaBrowserService);
    expect(tools.map((tool) => tool.name)).toEqual(BROWSER_CORE_TOOL_NAMES);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.output.schema).toBeDefined();
    }
  });

  it("never echoes browser_type values in result rendering", async () => {
    const service = {
      ensureSession: vi.fn(async () => ({ selectedTabId: "tab_test" })),
      type: vi.fn(async () => ({
        ok: true,
        sessionId: "session-test",
        tabId: "tab_test",
        revision: 2,
        url: "https://example.test/form",
        title: "Form",
        summary: "Typed into [e1].",
      })),
    } as unknown as QaBrowserService;
    const tool = createBrowserCoreTools(service).find(
      (candidate) => candidate.name === "browser_type",
    )!;
    const secret = "never-render-this-password";
    const value = await tool.execute(
      { ref: "e1", text: secret, clear: true },
      execution(),
    );
    const rendered = tool.output.render(
      { ref: "e1", text: secret, clear: true },
      value as never,
    );
    expect(JSON.stringify(rendered)).not.toContain(secret);
    expect(service.type).toHaveBeenCalledWith(
      "session-test",
      "tab_test",
      "e1",
      secret,
      { clear: true, submit: undefined },
    );
  });

  it("renders screenshots through the durable native image attachment path", async () => {
    const attachment = {
      attachmentId: "sha256:test",
      mediaType: "image/png",
      bytes: 1024,
      width: 1440,
      height: 900,
      name: "qa-browser-tab_test.png",
    };
    const service = {
      ensureSession: vi.fn(async () => ({ selectedTabId: "tab_test" })),
      screenshotArtifact: vi.fn(async () => attachment),
    } as unknown as QaBrowserService;
    const tools = createBrowserVisionTools(service);
    expect(tools.map((tool) => tool.name)).toEqual(BROWSER_VISION_TOOL_NAMES);

    const tool = tools[0]!;
    const value = await tool.execute({}, execution());
    expect(service.screenshotArtifact).toHaveBeenCalledWith(
      "session-test",
      "tab_test",
    );
    expect(tool.output.render({}, value as never)).toEqual([
      { type: "text", text: "Browser screenshot captured for tab_test." },
      { type: "image", attachment },
    ]);
  });
});
