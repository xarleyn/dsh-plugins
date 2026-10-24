import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import TypertGatewayService from "@deepseek-ai/dsh-api-gateway";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import { afterEach, describe, expect, it } from "vitest";
import { DraftSessionsService } from "../src/index.js";
import type { DraftSession } from "../src/shared/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

interface FixtureAccessRequest {
  readonly principal: { readonly kind: string };
}

type FixtureAccessDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string };

/**
 * Owner-only stand-in for the RemoteAccess service the Gateway injects since
 * Host 0.2.1. The real `@deepseek-ai/dsh-api-remote-access` package is not a
 * devDependency of this plugin, so the fixture re-applies the rule the real
 * service applies before consulting policies: the owner is always allowed.
 */
class FixtureRemoteAccess extends Service {
  constructor(ctx: Context) {
    super(ctx, "remoteAccess");
  }

  decide(request: FixtureAccessRequest): FixtureAccessDecision {
    return request.principal.kind === "owner"
      ? { kind: "allow" }
      : { kind: "deny", reason: "fixture-remote-access: no policy" };
  }
}

describe("Host Typert Gateway integration", () => {
  it("discovers and invokes the draftSessions service in source mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-draft-gateway-"));
    temporaryDirectories.push(directory);
    const ctx = new Context();
    await ctx.plugin(TypertRegistry);
    await ctx.plugin(FixtureRemoteAccess);
    await ctx.plugin(TypertGatewayService);
    await ctx.plugin(DraftSessionsService, {
      storagePath: join(directory, "drafts.json"),
    });

    // Every in-process caller names its Peer explicitly since Host 0.2.1.
    const peer = new Peer(ctx.root, { principal: { kind: "owner" } });
    try {
      const created = (await ctx.typertGateway.invoke({
        peer,
        namespace: "draftSessions",
        method: "create",
        args: {
          request: {
            workspaceId: "workspace-a",
            sessionId: "session-a",
            text: "unsent",
          },
        },
      })) as DraftSession;

      const updated = (await ctx.typertGateway.invoke({
        peer,
        namespace: "draftSessions",
        method: "update",
        args: {
          request: {
            id: created.id,
            expectedRevision: created.revision,
            text: "still unsent",
          },
        },
      })) as DraftSession;

      expect(updated).toMatchObject({
        sessionId: "session-a",
        text: "still unsent",
        revision: 2,
      });
    } finally {
      await peer.dispose();
    }
  });
});
