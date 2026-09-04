import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ScopeSession } from "../src/host-api.js";
import { SessionScopeReadService } from "../src/scope-remote.js";
import { SESSION_SCOPE_ERROR } from "../src/session-scope.js";

const temporaryDirectories: string[] = [];

function temporaryWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "dsh-session-scope-rpc-"));
  temporaryDirectories.push(workspace);
  return workspace;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("session scope read RPC", () => {
  test("exposes a non-durable directory listing bounded to the session workspace", async () => {
    const workspace = temporaryWorkspace();
    const visible = join(workspace, "visible");
    const outside = temporaryWorkspace();
    mkdirSync(visible);
    const session: ScopeSession = { header: { cwd: workspace }, events: [], append: vi.fn() };
    const ctx = new Context();
    ctx.provide("sessions", { get: (id: string) => id === "session" ? session : undefined });
    const service = new SessionScopeReadService(ctx, workspace);

    expect(service.typertRemote).toMatchObject({
      serviceKey: "sessionScopeRead",
      namespace: "sessionScope",
    });
    expect(remoteMethods(service)).toEqual([{ method: "list", invocation: { kind: "direct" } }]);
    await expect(service.list("session", workspace)).resolves.toMatchObject({
      entries: [expect.objectContaining({ name: "visible" })],
    });
    await expect(service.list("session", outside)).rejects.toMatchObject({
      code: SESSION_SCOPE_ERROR.OUTSIDE_WORKSPACE,
    });
    expect(session.append).not.toHaveBeenCalled();
  });
});
