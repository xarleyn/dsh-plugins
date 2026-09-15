import { z } from "zod";
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
  TypertRemoteNamespace,
} from "@deepseek-ai/dsh-typert-protocol";

import type { BrowserPanelFrame, BrowserPanelState } from "./types.js";

const viewportSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive(),
});

const sessionSchema = z.strictObject({
  sessionId: z.string().min(1),
  status: z.enum(["starting", "ready", "idle", "crashed", "closed"]),
  selectedTabId: z.string().min(1).nullable(),
  tabIds: z.array(z.string().min(1)),
  control: z.strictObject({
    owner: z.enum(["agent", "human"]),
    leaseExpiresAt: z.number().nullable(),
  }),
  profileName: z.string().nullable(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
});

const tabSchema = z.strictObject({
  id: z.string().min(1),
  url: z.string(),
  title: z.string(),
  status: z.enum(["loading", "ready", "failed", "closed"]),
  revision: z.number().int().nonnegative(),
  viewport: viewportSchema,
});

const stateSchema = z.strictObject({
  session: sessionSchema.nullable(),
  tabs: z.array(tabSchema),
  autoRevealOnAgentActivity: z.boolean(),
  focusOnAutoReveal: z.boolean(),
});

const frameSchema = z.strictObject({
  tabId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string(),
  mediaType: z.literal("image/png"),
  bytes: z.number().int().nonnegative().max(5 * 1024 * 1024),
  data: z.string(),
});

function descriptor(
  method: "panelState" | "panelFrame",
  parameters: InvocationDescriptor["parameters"],
  resultType: string,
  resultSchema: z.ZodType,
): InvocationDescriptor {
  return {
    id: `dsh-qa-browser#qaBrowser/${method}`,
    service: "qaBrowser",
    namespace: "qaBrowser",
    method,
    invocation: { kind: "direct" },
    parameters,
    result: { mode: "strict", typeSymbol: resultType, schema: resultSchema },
  };
}

const stringParameter = (
  name: string,
  allowEmpty = false,
): InvocationDescriptor["parameters"][number] => ({
  name,
  wire: name,
  source: "json",
  codec: {
    mode: "strict",
    typeSymbol: "string",
    schema: allowEmpty ? z.string() : z.string().min(1),
  },
});

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteMap {
    "qaBrowser/panelState": (
      qaToken: string,
      sessionId: string,
    ) => Promise<RemoteResult<BrowserPanelState>>;
    "qaBrowser/panelFrame": (
      qaToken: string,
      sessionId: string,
      tabId: string,
    ) => Promise<RemoteResult<BrowserPanelFrame>>;
  }

  interface TypertRemoteNamespaceMap {
    qaBrowser: TypertRemoteNamespace<"qaBrowser">;
  }
}

const qaBrowserRemote = {
  package: "dsh-qa-browser",
  descriptors: [
    descriptor(
      "panelState",
      [stringParameter("qaToken", true), stringParameter("sessionId")],
      "@yadsh/dsh-qa-browser/types#BrowserPanelState",
      stateSchema,
    ),
    descriptor(
      "panelFrame",
      [
        stringParameter("qaToken", true),
        stringParameter("sessionId"),
        stringParameter("tabId"),
      ],
      "@yadsh/dsh-qa-browser/types#BrowserPanelFrame",
      frameSchema,
    ),
  ],
} satisfies TypertRemoteContribution;

export default qaBrowserRemote;
