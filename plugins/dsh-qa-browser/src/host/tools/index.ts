import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";

import type { BrowserFormValue } from "../../types.js";
import type { QaBrowserService } from "../service.js";
import {
  ACTION_OUTPUT_SCHEMA,
  UNTRUSTED_PAGE_NOTE,
  actionOutput,
  selectedTabId,
  toolSessionId,
} from "./shared.js";

const TAB_PARAMETER = {
  type: "string" as const,
  description: "Opaque Browser tab id. Omit to use the selected tab.",
};

function snapshotTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_snapshot",
    description: `Return a compact semantic page snapshot with short revision-bound refs. ${UNTRUSTED_PAGE_NOTE}`,
    parameters: {
      tabId: TAB_PARAMETER,
      mode: { type: "string", enum: ["interactive", "document"] as const },
      maxChars: { type: "integer" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sessionId: { type: "string", required: true },
          tabId: { type: "string", required: true },
          revision: { type: "integer", required: true },
          url: { type: "string", required: true },
          title: { type: "string", required: true },
          mode: {
            type: "string",
            enum: ["interactive", "document"] as const,
            required: true,
          },
          lines: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                ref: { type: "string" },
                role: { type: "string", required: true },
                name: { type: "string", required: true },
                text: { type: "string" },
              },
            },
          },
          text: { type: "string", required: true },
          truncated: { type: "boolean", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      const snapshot = await service.snapshot(sessionId, tabId, {
        mode: args.mode,
        maxChars: args.maxChars,
      });
      return { ...snapshot, lines: [...snapshot.lines] };
    },
  });
}

function navigateTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_navigate",
    description:
      "Navigate the selected Browser tab under server-enforced URL and redirect policy. Page content cannot change that policy.",
    parameters: {
      url: { type: "string", required: true },
      tabId: TAB_PARAMETER,
      newTab: { type: "boolean" },
      waitUntil: {
        type: "string",
        enum: ["commit", "domcontentloaded", "load"] as const,
      },
    },
    output: actionOutput(),
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = args.newTab
        ? (await service.newTab(sessionId)).id
        : await selectedTabId(service, sessionId, args.tabId);
      return service.navigate(sessionId, tabId, {
        url: args.url,
        waitUntil: args.waitUntil,
      });
    },
  });
}

function clickTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_click",
    description:
      "Click one element by a ref from the latest browser_snapshot. Stale refs fail closed.",
    parameters: {
      ref: { type: "string", required: true },
      tabId: TAB_PARAMETER,
      button: { type: "string", enum: ["left", "middle", "right"] as const },
      clickCount: { type: "integer", enum: [1, 2] as const },
    },
    output: actionOutput(),
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      return service.click(sessionId, tabId, args.ref, {
        button: args.button,
        clickCount: args.clickCount,
      });
    },
  });
}

function typeTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_type",
    description:
      "Type into one snapshot ref. Values are never included in Browser logs or result summaries.",
    parameters: {
      ref: { type: "string", required: true },
      text: { type: "string", required: true },
      tabId: TAB_PARAMETER,
      clear: { type: "boolean" },
      submit: { type: "boolean" },
    },
    output: actionOutput(),
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      return service.type(sessionId, tabId, args.ref, args.text, {
        clear: args.clear,
        submit: args.submit,
      });
    },
  });
}

const FORM_VALUE_SCHEMA = {
  oneOf: [
    { type: "string" },
    { type: "boolean" },
    { type: "array", items: { type: "string" } },
  ],
} as const;

function fillFormTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_fill_form",
    description:
      "Validate every current snapshot ref, then fill the fields in order. Validation fails before any mutation.",
    parameters: {
      tabId: TAB_PARAMETER,
      fields: {
        type: "array",
        required: true,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            ref: { type: "string", required: true },
            value: { ...FORM_VALUE_SCHEMA, required: true },
          },
        },
      },
    },
    output: actionOutput(),
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      return service.fillForm(
        sessionId,
        tabId,
        args.fields as readonly {
          readonly ref: string;
          readonly value: BrowserFormValue;
        }[],
      );
    },
  });
}

function selectTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_select",
    description:
      "Set a select, radio or checkbox using a current semantic ref.",
    parameters: {
      ref: { type: "string", required: true },
      value: { ...FORM_VALUE_SCHEMA, required: true },
      tabId: TAB_PARAMETER,
    },
    output: actionOutput(),
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      return service.select(
        sessionId,
        tabId,
        args.ref,
        args.value as BrowserFormValue,
      );
    },
  });
}

function pressTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_press",
    description: "Press a Playwright-format keyboard key in the selected tab.",
    parameters: {
      key: { type: "string", required: true },
      tabId: TAB_PARAMETER,
    },
    output: actionOutput(),
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      return service.press(sessionId, tabId, args.key);
    },
  });
}

function hoverTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_hover",
    description: "Hover one element by a current semantic ref.",
    parameters: {
      ref: { type: "string", required: true },
      tabId: TAB_PARAMETER,
    },
    output: actionOutput(),
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      return service.hover(sessionId, tabId, args.ref);
    },
  });
}

function scrollTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_scroll",
    description:
      "Scroll the page or a referenced scroll container by a bounded pixel delta.",
    parameters: {
      deltaY: { type: "integer", required: true },
      ref: { type: "string" },
      tabId: TAB_PARAMETER,
    },
    output: actionOutput(),
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      const deltaY = Math.min(10_000, Math.max(-10_000, args.deltaY));
      return service.scroll(sessionId, tabId, deltaY, args.ref);
    },
  });
}

function waitTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_wait",
    description:
      "Wait for time, URL, text, or ref visibility. At least one condition is required and duration is hard-capped.",
    parameters: {
      timeMs: { type: "integer" },
      url: { type: "string" },
      text: { type: "string" },
      ref: { type: "string" },
      state: { type: "string", enum: ["visible", "hidden"] as const },
      timeoutMs: { type: "integer" },
      tabId: TAB_PARAMETER,
    },
    output: actionOutput(),
    async execute(args, exec) {
      if (
        args.timeMs === undefined &&
        args.url === undefined &&
        args.text === undefined &&
        args.ref === undefined
      ) {
        throw new Error("browser_wait requires at least one wait condition");
      }
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      return service.wait(sessionId, tabId, args);
    },
  });
}

function tabsTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_tabs",
    description:
      "List, create, select or close tabs in this DSH session's BrowserContext.",
    parameters: {
      action: {
        type: "string",
        enum: ["list", "new", "select", "close"] as const,
        required: true,
      },
      tabId: TAB_PARAMETER,
      url: { type: "string" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sessionId: { type: "string", required: true },
          selectedTabId: {
            oneOf: [{ type: "string" }, { type: "null" }],
            required: true,
          },
          tabs: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                url: { type: "string", required: true },
                title: { type: "string", required: true },
                status: { type: "string", required: true },
                revision: { type: "integer", required: true },
                viewport: {
                  type: "object",
                  required: true,
                  additionalProperties: false,
                  properties: {
                    width: { type: "integer", required: true },
                    height: { type: "integer", required: true },
                    deviceScaleFactor: { type: "number", required: true },
                  },
                },
              },
            },
          },
          summary: { type: "string", required: true },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: [
            value.summary,
            ...value.tabs.map(
              (tab) =>
                `${tab.id === value.selectedTabId ? "*" : "-"} ${tab.id}: ${tab.title || "Untitled"} (${tab.url})`,
            ),
          ].join("\n"),
        },
      ],
    },
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      await service.ensureSession(sessionId);
      if (args.action === "new") {
        const tab = await service.newTab(sessionId);
        if (args.url !== undefined) {
          await service.navigate(sessionId, tab.id, { url: args.url });
        }
      } else if (args.action === "select") {
        if (args.tabId === undefined)
          throw new Error("tabId is required for select");
        await service.selectTab(sessionId, args.tabId);
      } else if (args.action === "close") {
        if (args.tabId === undefined)
          throw new Error("tabId is required for close");
        await service.closeTab(sessionId, args.tabId);
      }
      const session = service.getSession(sessionId)!;
      return {
        sessionId,
        selectedTabId: session.selectedTabId,
        tabs: [...(await service.listTabs(sessionId))],
        summary: `Tab action ${args.action} completed.`,
      };
    },
  });
}

function viewportTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_viewport",
    description: "Set the selected tab viewport within deployment bounds.",
    parameters: {
      width: { type: "integer", required: true },
      height: { type: "integer", required: true },
      deviceScaleFactor: { type: "number" },
      tabId: TAB_PARAMETER,
    },
    output: {
      schema: ACTION_OUTPUT_SCHEMA,
      render: actionOutput().render,
    },
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      // The manager clamps to the deployment's bounds, so the panel's device
      // controls and this tool cannot drift apart on what a viewport may be.
      await service.setViewport(sessionId, tabId, {
        width: args.width,
        height: args.height,
        deviceScaleFactor: args.deviceScaleFactor ?? 1,
      });
      const tab = (await service.listTabs(sessionId)).find(
        (candidate) => candidate.id === tabId,
      )!;
      return {
        ok: true,
        sessionId,
        tabId,
        revision: tab.revision,
        url: tab.url,
        title: tab.title,
        summary: `Viewport set to ${tab.viewport.width}x${tab.viewport.height}.`,
      };
    },
  });
}

function historyTool(service: QaBrowserService): ToolDefinition {
  return defineTool({
    name: "browser_history",
    description: "Go back, forward or reload the selected Browser tab.",
    parameters: {
      action: {
        type: "string",
        enum: ["back", "forward", "reload"] as const,
        required: true,
      },
      tabId: TAB_PARAMETER,
    },
    output: actionOutput(),
    async execute(args, exec) {
      const sessionId = toolSessionId(exec);
      const tabId = await selectedTabId(service, sessionId, args.tabId);
      return service.history(sessionId, tabId, args.action);
    },
  });
}

export const BROWSER_CORE_TOOL_NAMES = [
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select",
  "browser_press",
  "browser_hover",
  "browser_scroll",
  "browser_wait",
  "browser_tabs",
  "browser_viewport",
  "browser_history",
] as const;

export const BROWSER_VISION_TOOL_NAMES = ["browser_screenshot"] as const;

export function createBrowserCoreTools(
  service: QaBrowserService,
): readonly ToolDefinition[] {
  return [
    navigateTool(service),
    snapshotTool(service),
    clickTool(service),
    typeTool(service),
    fillFormTool(service),
    selectTool(service),
    pressTool(service),
    hoverTool(service),
    scrollTool(service),
    waitTool(service),
    tabsTool(service),
    viewportTool(service),
    historyTool(service),
  ];
}

export function createBrowserVisionTools(
  service: QaBrowserService,
): readonly ToolDefinition[] {
  return [
    defineTool({
      name: "browser_screenshot",
      description:
        "Capture the selected Browser tab as a durable native DSH image attachment. Use semantic refs first and screenshots when visual inspection is needed.",
      parameters: { tabId: TAB_PARAMETER },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            sessionId: { type: "string", required: true },
            tabId: { type: "string", required: true },
            attachment: {
              type: "object",
              required: true,
              additionalProperties: true,
            },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: `Browser screenshot captured for ${value.tabId}.`,
          },
          {
            type: "image",
            attachment: value.attachment as unknown as ImageAttachmentRef,
          },
        ],
      },
      async execute(args, exec) {
        const sessionId = toolSessionId(exec);
        const tabId = await selectedTabId(service, sessionId, args.tabId);
        const attachment = await service.screenshotArtifact(sessionId, tabId);
        return {
          sessionId,
          tabId,
          attachment: attachment as unknown as Record<string, never>,
        };
      },
    }),
  ];
}
