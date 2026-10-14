import type { Context } from "@deepseek-ai/cordis";
import type {
  InvokeRemoteRequest,
  TypertGateway,
} from "@deepseek-ai/dsh-api-gateway";
import type { IncomingMessage, ServerResponse } from "node:http";
declare module "@deepseek-ai/cordis" {
  interface Events {
    "connection/request"(
      request: IncomingMessage,
      response: ServerResponse,
      next: () => Promise<void>,
    ): Promise<void>;
  }
}

export function qaNativeEndpointDenied(endpoint: string): boolean {
  const normalized = decodeURIComponent(endpoint).replace(/^\//u, "");
  // QA accounts are an application identity, whereas the Host's other APIs
  // authenticate the deployment operator. An unknown endpoint fails closed.
  if (normalized.startsWith("qaIntegrations/")) {
    // These installed integration-card methods resolve the QA token's own
    // principal. Keep the explicit method list so future operator APIs fail closed.
    const method = normalized.slice("qaIntegrations/".length);
    return ![
      "describe",
      "providers",
      "list",
      "managedServiceCredentials",
      "credentialSource",
      "serviceBoundary",
      "serviceHealth",
      ...[
        "Bitrix24",
        "Gitlab",
        "Confluence",
        "Teamcity",
        "Jira",
        "Testit",
        "Weblate",
      ].flatMap((provider) => [
        `get${provider}`,
        `put${provider}Credential`,
        `test${provider}`,
        `patch${provider}Policy`,
        `disconnect${provider}`,
      ]),
      "bitrix24Instances",
      "gitlabInstances",
      "confluenceSites",
      "teamcityServer",
      "jiraSites",
      "testitInstances",
      "weblateInstances",
    ].includes(method);
  }
  // Replies to Host-wide waterfalls have no QA identity either. All approval
  // decisions must use the tokenized owner-only QA operations.
  return normalized.split("/")[0] !== "qaSurface";
}

/** Native operator APIs carry no QA identity. Accounts use the QA transport. */
export function installQaNativeFence(
  ctx: Context,
  enabled: () => boolean,
): () => void {
  const gateway = ctx.get("typertGateway") as TypertGateway | undefined;
  if (gateway === undefined)
    throw new Error("QA accounts require the Typert gateway boundary.");
  const invoke = gateway.invoke;
  const stream = gateway.stream;
  const open = gateway.wireStream.open;
  // Only Connection can attest a cookie role and the peer minted from it.
  // Older Hosts without this capability retain the closed account boundary.
  const connection = ctx.get("connection") as unknown as
    | {
        isOperatorRequest?(request: IncomingMessage): boolean;
        isOperatorPeer?(peer: unknown): boolean;
      }
    | undefined;
  const operatorPeer = (peer: unknown): boolean =>
    peer !== undefined && connection?.isOperatorPeer?.(peer) === true;
  const check = (request: InvokeRemoteRequest) => {
    if (
      enabled() &&
      !operatorPeer(request.peer) &&
      qaNativeEndpointDenied(request.namespace + "/" + request.method)
    )
      throw new Error(
        "QA account authentication is required through the QA chat API.",
      );
  };
  gateway.invoke = async function (request) {
    check(request);
    return invoke.call(this, request);
  };
  gateway.stream = async function (request) {
    check(request);
    return stream.call(this, request);
  };
  const wire = gateway.wireStream as { open: typeof open };
  wire.open = async function (endpoint, payload, uplink, peer, signal) {
    if (
      enabled() &&
      !operatorPeer(peer) &&
      endpoint !== "$events" &&
      qaNativeEndpointDenied(endpoint)
    )
      throw new Error(
        "QA account authentication is required through the QA chat API.",
      );
    const source = await open.call(
      this,
      endpoint,
      payload,
      uplink,
      peer,
      signal,
    );
    if (endpoint !== "$events") return source;
    return (async function* () {
      for await (const frame of source) {
        // Remote notifications are Host-wide and have no account token. The
        // authenticated QA control/follow streams replace them for this surface.
        if (enabled() && !operatorPeer(peer)) {
          if (
            typeof frame !== "object" ||
            frame === null ||
            !("type" in frame) ||
            frame.type !== "ready"
          )
            continue;
          yield { ...frame, host: { home: "" } };
          continue;
        }
        yield frame;
      }
    })();
  };
  const stopHttp = ctx.on(
    "connection/request",
    async (request, response, next) => {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
      const api = pathname.indexOf("/api/");
      if (
        enabled() &&
        connection?.isOperatorRequest?.(request) !== true &&
        api >= 0 &&
        pathname.slice(api + 5) !== "qa-chat-upload" &&
        pathname.slice(api + 5) !== "remote.mux" &&
        qaNativeEndpointDenied(pathname.slice(api + 5))
      ) {
        response.writeHead(403, { "Cache-Control": "no-store" });
        response.end(
          "QA account authentication is required through the QA chat API.",
        );
        return;
      }
      await next();
    },
  );
  return () => {
    stopHttp();
    gateway.invoke = invoke;
    gateway.stream = stream;
    wire.open = open;
  };
}
