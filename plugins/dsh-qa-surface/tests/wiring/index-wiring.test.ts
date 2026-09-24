import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import type { IndexInjection } from "@deepseek-ai/dsh-host-webserver";
import {
  isTypertRemoteSegment,
  remoteMethods,
} from "@deepseek-ai/dsh-typert-protocol";
import { QaSurface } from "../../src/index.js";

/**
 * Wiring under a real Cordis context.
 *
 * Every other suite drives one module directly, which leaves `src/index.ts`
 * itself unmeasured: the service was never constructed in a test, so the lines
 * that exist only there — reading the config source, finding the agent behind a
 * session, folding a refusal into the `(reason: <code>)` marker the browser
 * branches on, and the `name` / `inject` / `Config` the host loads the plugin
 * through — held together on typing and review alone.
 */

/**
 * One fixed directory, wiped at load: the capability store keeps its SQLite
 * handle open for the life of the process, so on Windows only the previous
 * run's leftovers are reliably removable here.
 */
const HOME = path.join(tmpdir(), "dsh-qa-surface-wiring");
const WORKSPACE = path.join(HOME, "workspace");

rmSync(HOME, { recursive: true, force: true });
mkdirSync(path.join(WORKSPACE, "docs"), { recursive: true });
writeFileSync(
  path.join(WORKSPACE, "docs", "guide.md"),
  "# Guide\n\nСодержание.\n",
  "utf8",
);
process.env.DSH_HOME = HOME;
process.env.DSH_LOG_DISABLED = "1";

interface Route {
  readonly kind: string;
  readonly path: string;
}

async function world(entry: Record<string, unknown> = {}) {
  const ctx = new Context();
  const agents = new Map<string, Record<string, unknown>>();
  const routes: Route[] = [];
  const registeredTools: string[] = [];
  const created: Record<string, unknown>[] = [];
  const modelChoices: Record<string, unknown>[] = [];
  /** The model the Host recorded per session, replayed onto a resumed agent. */
  const selected = new Map<string, Record<string, unknown>>();
  /** The chats this Host actually has a durable session for. */
  const hostSessions = new Set<string>();
  let resumable = true;
  let section:
    | {
        readonly namespace: string;
        readonly setSource: (source: () => unknown) => void;
        readonly onChange: () => void;
      }
    | undefined;

  /** Materialize the live agent the Host would have built for this chat. */
  const chat = (sessionId: string, cwd?: string): Record<string, unknown> => {
    const agent = {
      id: sessionId,
      ctx,
      options: selected.get(sessionId) ?? {},
      session: {
        id: sessionId,
        header: {
          id: sessionId,
          createdAt: Date.now(),
          ...(cwd === undefined ? {} : { cwd }),
        },
        surface: { nodes: [] },
        snapshotEvents: () => [],
        eventAt: () => undefined,
      },
    };
    agents.set(sessionId, agent);
    return agent;
  };

  ctx.provide("agents", {
    get: (id: unknown) => agents.get(String(id)),
    list: () => [...agents.values()],
  } as never);
  ctx.provide("sessions", {
    get: (id: unknown) => agents.get(String(id))?.session,
    list: () => [...agents.values()].map((agent) => agent.session),
  } as never);
  ctx.provide("agentPresets", {
    standingKeyFor: async () => undefined,
    composedPreset: () => "",
  } as never);
  ctx.provide("permissionPresets", {
    resolve: () => ({ sandbox: "read-only", approval: "never" }),
    set: (_session: unknown, preset: string) => ({ preset }),
    current: () => "qa-read-only",
  } as never);
  ctx.provide("tools", {
    register: (definition: { name: string }) => {
      registeredTools.push(definition.name);
      return () => {
        const index = registeredTools.indexOf(definition.name);
        if (index >= 0) registeredTools.splice(index, 1);
      };
    },
    guard: () => () => undefined,
    restrict: () => () => undefined,
    get: () => undefined,
    list: () => [],
  } as never);
  ctx.provide("systemPrompt", {} as never);
  ctx.provide("workspaceRegistry", {
    get: (id: unknown) =>
      String(id) === "ws-1" ? { id, path: WORKSPACE } : undefined,
  } as never);
  ctx.provide("sessionController", {
    create: async (input: Record<string, unknown>) => {
      created.push(input);
      const sessionId = String(input.sessionId);
      hostSessions.add(sessionId);
      return { sessionId };
    },
    selectModel: async (input: Record<string, unknown>) => {
      modelChoices.push(input);
      // The Host remembers the choice for the session, so an agent resumed
      // afterwards carries it — which is what the composition check reads back.
      selected.set(String(input.sessionId), {
        provider: input.provider,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
      });
    },
    resolveAgent: async (id: unknown) => {
      const sessionId = String(id);
      if (!resumable || !hostSessions.has(sessionId)) {
        return { error: { message: "no such session" } };
      }
      return { agent: chat(sessionId, WORKSPACE) };
    },
  } as never);
  ctx.provide("settings", {
    installSection(
      _owner: unknown,
      namespace: string,
      _schema: unknown,
      _entry: unknown,
      hooks: {
        setSource(source: () => unknown): void;
        onChange(): void;
      },
    ) {
      section = {
        namespace,
        setSource: hooks.setSource,
        onChange: hooks.onChange,
      };
    },
  } as never);
  ctx.provide("webServer", {
    register: (route: Route) => {
      routes.push(route);
      return () => {
        const index = routes.indexOf(route);
        if (index >= 0) routes.splice(index, 1);
      };
    },
  } as never);

  const fiber = ctx.plugin(QaSurface, entry as never);
  await fiber;
  const started = ctx.qaSurface;
  return {
    ctx,
    chat,
    created,
    modelChoices,
    registeredTools,
    routes,
    section,
    surface: started,
    /** Make every chat look like one the Host can no longer wake up. */
    stopResuming: () => {
      resumable = false;
    },
    dispose: () => fiber.dispose(),
  };
}

/** The `(reason: <code>)` marker the browser's panel branches on. */
async function refusalReason(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    const reason = /\(reason: ([a-z-]+)\)/u
      .exec(error instanceof Error ? error.message : String(error))
      ?.at(1);
    if (reason === undefined) throw error;
    return reason;
  }
  throw new Error("expected the remote to refuse");
}

afterAll(() => {
  delete process.env.DSH_HOME;
  delete process.env.DSH_LOG_DISABLED;
  rmSync(WORKSPACE, { recursive: true, force: true });
  // The capability store keeps its handle for the life of the process, so the
  // home itself is left for the next run's load-time wipe.
});

describe("wiring: the host entry point", () => {
  it("loads through ctx.plugin and answers as ctx.qaSurface", async () => {
    const { surface, registeredTools, dispose } = await world();
    expect(surface).toBeInstanceOf(QaSurface);
    expect(surface.name).toBe("qaSurface");
    // The provenance reporter reaches the tool registry through the mount the
    // host performed, not through a test seam.
    expect(registeredTools).toContain("qa_report_sources");
    await dispose();
    expect(registeredTools).toEqual([]);
  });

  it("keeps every Remote name a distinct wire-safe segment", async () => {
    const { surface, dispose } = await world();
    const names = remoteMethods(surface as never).map(
      (marker) => marker.exportName ?? marker.method,
    );
    // The gateway binds by these strings, and the generated client is built
    // from them: a lost marker or a collided name reaches the browser as an
    // endpoint that simply is not there.
    for (const name of [
      "describe",
      "createSession",
      "secureSession",
      "sources",
      "slashCatalog",
      "adminOverview",
    ]) {
      expect(names).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(isTypertRemoteSegment(name)).toBe(true);
    await dispose();
  });

  it("installs its settings section under the namespace the card binds to", async () => {
    const { section, dispose } = await world();
    expect(section?.namespace).toBe("qa-surface");
    await dispose();
  });
});

describe("wiring: the config reaches the host", () => {
  it("serves the boot entry as the resolved config, then follows the settings source", async () => {
    const { surface, section, dispose } = await world({
      route: { path: "/help" },
    });
    expect(surface.describe()).toMatchObject({
      enabled: true,
      route: { path: "/help" },
    });
    // The browser's config channel reads the live source, not the snapshot the
    // plugin booted with.
    section?.setSource(() => ({ route: { path: "/ask" } }));
    expect(surface.describe().route.path).toBe("/ask");
    await dispose();
  });

  it("moves the navigation route with the config and drops it on unload", async () => {
    const { routes, section, dispose } = await world();
    expect(routes.map((route) => route.path)).toEqual(["/qa"]);
    section?.setSource(() => ({ route: { path: "/ask" } }));
    section?.onChange();
    expect(routes.map((route) => route.path)).toEqual(["/ask"]);
    await dispose();
    expect(routes).toEqual([]);
  });

  it("hands the entry redirect to the index injector while the switch is on", async () => {
    const { ctx, dispose } = await world();
    const table: IndexInjection[] = [];
    ctx.emit("webserver/index-inject", table);
    expect(table).toEqual([
      {
        kind: "script",
        placement: "head",
        text: expect.stringContaining("/qa"),
      },
    ]);
    await dispose();
  });

  it("keeps the redirect out of the index once the entry switch is off", async () => {
    const { ctx, dispose } = await world({
      entry: { redirectNonLoopback: false },
    });
    const table: IndexInjection[] = [];
    ctx.emit("webserver/index-inject", table);
    expect(table).toEqual([]);
    await dispose();
  });

  it("maps the session config onto the Host create and selectModel calls", async () => {
    const { surface, created, modelChoices, dispose } = await world({
      session: {
        workspaceId: "ws-1",
        provider: "demo",
        model: "demo-model",
        reasoningEffort: "low",
      },
    });
    const sessionId = await surface.createSession("", null, false);
    expect(created).toEqual([{ sessionId, workspaceId: "ws-1" }]);
    expect(modelChoices).toEqual([
      {
        sessionId,
        provider: "demo",
        model: "demo-model",
        reasoningEffort: "low",
      },
    ]);
    await dispose();
  });

  it("refuses a fixed session before the Host ever sees a create", async () => {
    const { surface, created, dispose } = await world({
      session: { policy: "fixed", fixedSessionId: "session-fixed" },
    });
    await expect(surface.createSession("", null, false)).rejects.toThrow(
      /Fixed QA sessions cannot be created/u,
    );
    expect(created).toEqual([]);
    await dispose();
  });
});

describe("wiring: agent lookup and refusal reasons", () => {
  it("reads the browse root off the live agent, not off the config", async () => {
    // `session.cwd` stays null in this deployment: only the agent knows where
    // the chat actually runs, and a browse that missed it would list nothing.
    const { surface, chat, dispose } = await world();
    chat("session-1", WORKSPACE);
    await expect(
      surface.listWorkspaceFiles("", "session-1", ""),
    ).resolves.toMatchObject({
      path: "",
      entries: [{ name: "docs", type: "directory", size: null }],
    });
    await dispose();
  });

  it("refuses a chat whose agent carries no cwd as unavailable", async () => {
    const { surface, chat, dispose } = await world();
    chat("session-1");
    expect(
      await refusalReason(surface.listWorkspaceFiles("", "session-1", "")),
    ).toBe("unavailable");
    await dispose();
  });

  it("folds a browse outside the chat's own tree into the outside-roots marker", async () => {
    const { surface, chat, dispose } = await world();
    chat("session-1", WORKSPACE);
    expect(
      await refusalReason(surface.listWorkspaceFiles("", "session-1", "..")),
    ).toBe("outside-roots");
    await dispose();
  });

  it("refuses file preview while the deployment has it switched off", async () => {
    const { surface, chat, dispose } = await world({
      sources: { filePreview: { enabled: false } },
    });
    chat("session-1", WORKSPACE);
    expect(
      await refusalReason(
        surface.readSourceFile("", "session-1", "docs/guide.md"),
      ),
    ).toBe("unavailable");
    await dispose();
  });

  it("refuses a path the turn never cited as foreign evidence", async () => {
    const { surface, chat, dispose } = await world();
    chat("session-1", WORKSPACE);
    expect(
      await refusalReason(
        surface.readSourceFile("", "session-1", "docs/guide.md"),
      ),
    ).toBe("not-evidence");
    await dispose();
  });

  it("refuses a Word preview as unsupported while no document pipeline is mounted", async () => {
    const { surface, chat, dispose } = await world();
    chat("session-1", WORKSPACE);
    expect(
      await refusalReason(
        surface.previewWorkspaceDocument("", "session-1", "docs/dogovor.docx"),
      ),
    ).toBe("unsupported");
    await dispose();
  });

  it("carries an attestation reason onto the wire and keeps the detail in the log", async () => {
    const { surface, dispose } = await world();
    await expect(surface.secureSession("", "session-ghost")).rejects.toThrow(
      /^Assistant configuration is unavailable\. \(reason: agent-unavailable\)$/u,
    );
    await dispose();
  });

  it("folds the reason of a failed create into the message the browser reads", async () => {
    const { surface, created, stopResuming, dispose } = await world();
    stopResuming();
    await expect(
      refusalReason(surface.createSession("", null, false)),
    ).resolves.toBe("agent-unavailable");
    // The session was created and then refused, so the reservation went with it.
    expect(created).toHaveLength(1);
    await dispose();
  });
});
