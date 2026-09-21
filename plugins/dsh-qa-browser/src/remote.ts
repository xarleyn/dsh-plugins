import { z } from "zod";
import { QA_BROWSER_ERROR_CODES } from "./errors.js";
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
  TypertRemoteNamespace,
} from "@deepseek-ai/dsh-typert-protocol";

import type {
  BrowserActionResult,
  BrowserControlState,
  BrowserPanelFrame,
  BrowserPanelHistoryAction,
  BrowserPanelState,
} from "./types.js";

/** Every panel method the Host decorates and the wire descriptors carry. */
export const PANEL_REMOTE_METHODS = [
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
] as const;

export type PanelRemoteMethod = (typeof PANEL_REMOTE_METHODS)[number];

const viewportSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive(),
});

const controlSchema: z.ZodType<BrowserControlState> = z.discriminatedUnion(
  "owner",
  [
    z.strictObject({ owner: z.literal("agent"), leaseExpiresAt: z.null() }),
    z.strictObject({
      owner: z.literal("human"),
      clientId: z.string().min(1).max(128),
      leaseExpiresAt: z.number(),
    }),
  ],
);

const sessionSchema = z.strictObject({
  sessionId: z.string().min(1),
  status: z.enum(["starting", "ready", "idle", "crashed", "closed"]),
  selectedTabId: z.string().min(1).nullable(),
  tabIds: z.array(z.string().min(1)),
  control: controlSchema,
  profileName: z.string().nullable(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
});

const refusalSchema = z.strictObject({
  code: z.enum(QA_BROWSER_ERROR_CODES),
  kind: z.enum(["document", "resource"]),
  host: z.string().max(255),
  message: z.string().min(1),
  count: z.number().int().positive(),
});

/** The Host caps both lists; the wire keeps a bound of its own, so neither a
 * compromised nor an outdated Host can make the panel render an unbounded
 * list. */
const refusalsSchema = z.array(refusalSchema).max(16);

const tabSchema = z.strictObject({
  id: z.string().min(1),
  url: z.string(),
  title: z.string(),
  status: z.enum(["loading", "ready", "failed", "closed"]),
  revision: z.number().int().nonnegative(),
  viewport: viewportSchema,
  history: z.strictObject({
    back: z.number().int().nonnegative(),
    forward: z.number().int().nonnegative(),
  }),
  policyRefusals: refusalsSchema,
});

const stateSchema = z.strictObject({
  session: sessionSchema.nullable(),
  tabs: z.array(tabSchema),
  policyRefusals: refusalsSchema,
  humanControlEnabled: z.boolean(),
  humanControlLeaseSeconds: z.number().int().min(5).max(300),
  autoRevealOnAgentActivity: z.boolean(),
  focusOnAutoReveal: z.boolean(),
  coordinateInputEnabled: z.boolean(),
});

const frameSchema = z.strictObject({
  tabId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string(),
  mediaType: z.literal("image/png"),
  bytes: z
    .number()
    .int()
    .nonnegative()
    .max(5 * 1024 * 1024),
  data: z.string(),
});

const actionResultSchema: z.ZodType<BrowserActionResult> = z.strictObject({
  ok: z.boolean(),
  sessionId: z.string().min(1),
  tabId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string(),
  summary: z.string(),
  navigation: z
    .strictObject({ from: z.string().optional(), to: z.string().optional() })
    .optional(),
});

function descriptor(
  method: PanelRemoteMethod,
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

const numberParameter = (
  name: string,
): InvocationDescriptor["parameters"][number] => ({
  name,
  wire: name,
  source: "json",
  codec: { mode: "strict", typeSymbol: "number", schema: z.number().finite() },
});

const nullableButtonParameter: InvocationDescriptor["parameters"][number] = {
  name: "button",
  wire: "button",
  source: "json",
  codec: {
    mode: "strict",
    typeSymbol: '"left" | "middle" | "right" | null',
    schema: z.enum(["left", "middle", "right"]).nullable(),
  },
};

const clickCountParameter: InvocationDescriptor["parameters"][number] = {
  name: "clickCount",
  wire: "clickCount",
  source: "json",
  codec: {
    mode: "strict",
    typeSymbol: "1 | 2",
    schema: z.union([z.literal(1), z.literal(2)]),
  },
};

const authParameters = [
  stringParameter("qaToken", true),
  stringParameter("sessionId"),
];

const controlParameters = [...authParameters, stringParameter("clientId")];

const tabControlParameters = [
  ...authParameters,
  stringParameter("tabId"),
  stringParameter("clientId"),
];

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
    "qaBrowser/panelTakeControl": (
      qaToken: string,
      sessionId: string,
      clientId: string,
    ) => Promise<RemoteResult<BrowserControlState>>;
    "qaBrowser/panelControlHeartbeat": (
      qaToken: string,
      sessionId: string,
      clientId: string,
    ) => Promise<RemoteResult<BrowserControlState>>;
    "qaBrowser/panelReleaseControl": (
      qaToken: string,
      sessionId: string,
      clientId: string,
    ) => Promise<RemoteResult<BrowserControlState>>;
    "qaBrowser/panelSelectTab": (
      qaToken: string,
      sessionId: string,
      tabId: string,
      clientId: string,
    ) => Promise<RemoteResult<boolean>>;
    "qaBrowser/panelNavigate": (
      qaToken: string,
      sessionId: string,
      tabId: string,
      clientId: string,
      url: string,
    ) => Promise<RemoteResult<BrowserActionResult>>;
    "qaBrowser/panelPointer": (
      qaToken: string,
      sessionId: string,
      tabId: string,
      clientId: string,
      action: "move" | "click" | "down" | "up",
      x: number,
      y: number,
      button: "left" | "middle" | "right" | null,
      clickCount: number,
    ) => Promise<RemoteResult<BrowserActionResult>>;
    "qaBrowser/panelKey": (
      qaToken: string,
      sessionId: string,
      tabId: string,
      clientId: string,
      key: string,
    ) => Promise<RemoteResult<BrowserActionResult>>;
    "qaBrowser/panelText": (
      qaToken: string,
      sessionId: string,
      tabId: string,
      clientId: string,
      text: string,
    ) => Promise<RemoteResult<BrowserActionResult>>;
    "qaBrowser/panelScroll": (
      qaToken: string,
      sessionId: string,
      tabId: string,
      clientId: string,
      deltaX: number,
      deltaY: number,
    ) => Promise<RemoteResult<BrowserActionResult>>;
    "qaBrowser/panelNewTab": (
      qaToken: string,
      sessionId: string,
      clientId: string,
    ) => Promise<RemoteResult<BrowserPanelState>>;
    "qaBrowser/panelCloseTab": (
      qaToken: string,
      sessionId: string,
      tabId: string,
      clientId: string,
    ) => Promise<RemoteResult<BrowserPanelState>>;
    "qaBrowser/panelHistory": (
      qaToken: string,
      sessionId: string,
      tabId: string,
      clientId: string,
      action: BrowserPanelHistoryAction,
    ) => Promise<RemoteResult<BrowserPanelState>>;
    "qaBrowser/panelViewport": (
      qaToken: string,
      sessionId: string,
      tabId: string,
      clientId: string,
      width: number,
      height: number,
    ) => Promise<RemoteResult<BrowserPanelState>>;
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
      authParameters,
      "@yadsh/dsh-qa-browser/types#BrowserPanelState",
      stateSchema,
    ),
    descriptor(
      "panelFrame",
      [...authParameters, stringParameter("tabId")],
      "@yadsh/dsh-qa-browser/types#BrowserPanelFrame",
      frameSchema,
    ),
    ...(
      [
        "panelTakeControl",
        "panelControlHeartbeat",
        "panelReleaseControl",
      ] as const
    ).map((method) =>
      descriptor(
        method,
        controlParameters,
        "@yadsh/dsh-qa-browser/types#BrowserControlState",
        controlSchema,
      ),
    ),
    descriptor("panelSelectTab", tabControlParameters, "boolean", z.boolean()),
    descriptor(
      "panelNavigate",
      [...tabControlParameters, stringParameter("url")],
      "@yadsh/dsh-qa-browser/types#BrowserActionResult",
      actionResultSchema,
    ),
    descriptor(
      "panelPointer",
      [
        ...tabControlParameters,
        {
          name: "action",
          wire: "action",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "BrowserHumanPointerAction",
            schema: z.enum(["move", "click", "down", "up"]),
          },
        },
        numberParameter("x"),
        numberParameter("y"),
        nullableButtonParameter,
        clickCountParameter,
      ],
      "@yadsh/dsh-qa-browser/types#BrowserActionResult",
      actionResultSchema,
    ),
    ...(["panelKey", "panelText"] as const).map((method) =>
      descriptor(
        method,
        [
          ...tabControlParameters,
          stringParameter(method === "panelKey" ? "key" : "text", true),
        ],
        "@yadsh/dsh-qa-browser/types#BrowserActionResult",
        actionResultSchema,
      ),
    ),
    descriptor(
      "panelScroll",
      [
        ...tabControlParameters,
        numberParameter("deltaX"),
        numberParameter("deltaY"),
      ],
      "@yadsh/dsh-qa-browser/types#BrowserActionResult",
      actionResultSchema,
    ),
    descriptor(
      "panelNewTab",
      controlParameters,
      "@yadsh/dsh-qa-browser/types#BrowserPanelState",
      stateSchema,
    ),
    descriptor(
      "panelCloseTab",
      tabControlParameters,
      "@yadsh/dsh-qa-browser/types#BrowserPanelState",
      stateSchema,
    ),
    descriptor(
      "panelHistory",
      [
        ...tabControlParameters,
        {
          name: "action",
          wire: "action",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "BrowserPanelHistoryAction",
            schema: z.enum(["back", "forward", "reload"]),
          },
        },
      ],
      "@yadsh/dsh-qa-browser/types#BrowserPanelState",
      stateSchema,
    ),
    descriptor(
      "panelViewport",
      [
        ...tabControlParameters,
        numberParameter("width"),
        numberParameter("height"),
      ],
      "@yadsh/dsh-qa-browser/types#BrowserPanelState",
      stateSchema,
    ),
  ],
} satisfies TypertRemoteContribution;

export default qaBrowserRemote;
