import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
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

describe("Host Typert Gateway integration", () => {
  it("discovers and invokes the draftSessions service in source mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-draft-gateway-"));
    temporaryDirectories.push(directory);
    const ctx = new Context();
    await ctx.plugin(TypertRegistry);
    await ctx.plugin(TypertGatewayService);
    await ctx.plugin(DraftSessionsService, {
      storagePath: join(directory, "drafts.json"),
    });

    const created = (await ctx.typertGateway.invoke({
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
  });
});
