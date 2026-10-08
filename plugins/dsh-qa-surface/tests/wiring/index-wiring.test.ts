import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import type { IndexInjection } from "@deepseek-ai/dsh-host-webserver";
import {
  isTypertRemoteSegment,
  remoteMethods,
} from "@deepseek-ai/dsh-typert-protocol";
import { QA_SURFACE_SETTINGS_NAMESPACE, QaSurface } from "../../src/index.js";

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
  /**
   * The chats the harness holds live right now, split the way the Host splits
   * them: `liveRoots` are the top-level turns a request ceiling counts, and
   * `liveChildren` are the delegated experts riding underneath one of them.
   */
  const liveRoots: Record<string, unknown>[] = [];
  const liveChildren: Record<string, unknown>[] = [];
  const routes: Route[] = [];
  const registeredTools: string[] = [];
  const created: Record<string, unknown>[] = [];
  const modelChoices: Record<string, unknown>[] = [];
  /** The model the Host recorded per session, replayed onto a resumed agent. */
  const selected = new Map<string, Record<string, unknown>>();
  /** The chats this Host actually has a durable session for. */
  const hostSessions = new Set<string>();
  /** Identities subagent routing owns: resumed, they answer `session/agent-busy`. */
  const routed = new Set<string>();
  let resumable = true;
  /** The page policy the plugin registered for its own profile entry. */
  let presentation: { readonly auto?: boolean } | undefined;

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
    list: () => [...agents.values(), ...liveRoots, ...liveChildren],
    roots: () => liveRoots,
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
    // The policy's pair is checked against this before the Host is asked to
    // select it, so a stand that names a model nobody offers refuses the chat
    // rather than the first question inside it.
    modelCatalog: async () => ({
      default: { provider: "demo", model: "demo-model" },
      routableProviders: ["demo"],
      groups: [
        {
          id: "demo",
          name: "Demo",
          models: [{ id: "demo-model", name: "Demo model" }],
        },
      ],
      failures: [],
    }),
    resolveAgent: async (id: unknown) => {
      const sessionId = String(id);
      if (routed.has(sessionId)) {
        return {
          error: {
            code: "session/agent-busy",
            message: `session "${sessionId}" is owned by subagent routing`,
          },
        };
      }
      if (!resumable || !hostSessions.has(sessionId)) {
        return { error: { message: "no such session" } };
      }
      return { agent: chat(sessionId, WORKSPACE) };
    },
  } as never);
  ctx.provide("settings", {
    // `rc.2` derives the settings namespace from the entry's volatile Config
    // fields; a plugin only declares whether the generated page may appear.
    configure(options: { auto?: boolean }) {
      presentation = options;
      return () => {};
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
    presentation: () => presentation,
    surface: started,
    /** Put a top-level turn on the stand, answering or not. */
    liveRoots,
    /** Put a delegated expert underneath one, which shares its place. */
    liveChildren,
    /** Make every chat look like one the Host can no longer wake up. */
    stopResuming: () => {
      resumable = false;
    },
    /** Make one identity one subagent routing owns. */
    routeSession: (sessionId: string) => {
      routed.add(sessionId);
      hostSessions.add(sessionId);
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

  it("keeps the generated settings page off for the entry its card binds to", async () => {
    const { presentation, dispose } = await world();
    // The card draws this entry's page itself, so the Host must not add a second
    // one beside it.
    expect(presentation()).toEqual({ auto: false });
    await dispose();
  });

  it("binds its card to the profile entry id the bundle declares", async () => {
    // The settings namespace IS the entry id at `rc.2`, so the browser card's
    // join key and `cordis.patch.yml` have to name the same entry: a drift shows
    // up as a card that simply never finds a form to edit.
    const patch = readFileSync(
      new URL("../../cordis.patch.yml", import.meta.url),
      "utf8",
    );
    expect(QA_SURFACE_SETTINGS_NAMESPACE).toBe("dsh-qa-surface");
    expect(patch).toContain(`id: ${QA_SURFACE_SETTINGS_NAMESPACE}`);
  });
});

describe("wiring: the request ceiling is counted on the Host", () => {
  it("counts the top-level turns the harness reports, and only those", async () => {
    const { surface, liveRoots, liveChildren, dispose } = await world({
      session: { maxActiveRequests: 2 },
    });
    // Nothing was ever sent through this plugin, so every place the answer
    // counts arrived by another road: the HTTP API, another account, another
    // surface. That is why the read lives here and not in the browser.
    liveRoots.push({ status: "idle" }, { status: "running" });
    // A delegated expert is a live agent and not a root: it rides the turn that
    // delegated it, and counting it would bill one conversation twice.
    liveChildren.push({ status: "running" }, { status: "running" });
    expect(surface.queueStatus()).toEqual({ limit: 2, active: 1, full: false });
    liveRoots.push({ status: "running" });
    expect(surface.queueStatus()).toMatchObject({ active: 2, full: true });
    await dispose();
  });

  it("reports a stand without a ceiling as never full", async () => {
    const { surface, liveRoots, dispose } = await world();
    for (let index = 0; index < 9; index += 1)
      liveRoots.push({ status: "running" });
    // The default config sets no ceiling, so the browser is told the truth
    // rather than a full stand it would have to refuse a visitor over.
    expect(surface.queueStatus()).toEqual({ limit: 0, active: 9, full: false });
    await dispose();
  });
});

describe("wiring: the config reaches the host", () => {
  it("serves the entry the Host resolved as the config every remote reads", async () => {
    const { surface, dispose } = await world({
      route: { path: "/help" },
    });
    expect(surface.describe()).toMatchObject({
      enabled: true,
      route: { path: "/help" },
    });
    await dispose();
  });

  it("registers the route the entry names and drops it on unload", async () => {
    const { routes, dispose } = await world({ route: { path: "/ask" } });
    expect(routes.map((route) => route.path)).toEqual(["/ask"]);
    await dispose();
    expect(routes).toEqual([]);
  });

  it("survives a configuration change the Host reports, for its own and for another entry", async () => {
    const { ctx, routes, dispose } = await world();
    // Every Config field is a volatile reference, so a committed change is
    // already visible to the next read; what the notification drives is the
    // re-sync of the parts that are not read per operation. A listener that
    // tripped over its own read would surface here as a throw out of `emit`.
    // The bus is driven directly because the namespace is a branded Host type
    // this package does not depend on.
    ctx.events.emit("settings/document-updated", "another-entry", 1);
    ctx.events.emit(
      "settings/document-updated",
      QA_SURFACE_SETTINGS_NAMESPACE,
      1,
    );
    expect(routes.map((route) => route.path)).toEqual(["/qa"]);
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

describe("wiring: the failed turn reaches the operator's log", () => {
  /**
   * The console mirror is what `docker compose logs` shows, so the host logger
   * object the plugin's sink was handed is read here instead of the log file.
   * What one line carries is decided by the wiring in `src/index.ts`: the unit
   * test feeds its own ownership resolver, so only here does a regression back
   * to a boolean predicate — or a seam that stopped installing the ownership
   * listener — show up as a wrong or missing line.
   */
  function mirrorErrors(ctx: Context): string[] {
    const lines: string[] = [];
    const host = ctx.logger;
    host.error = ((message: unknown) => {
      lines.push(String(message));
    }) as typeof host.error;
    return lines;
  }

  /** The same mirror, with each line tagged by the level it was written at. */
  function mirrorLevels(ctx: Context): string[] {
    const lines: string[] = [];
    const host = ctx.logger;
    const at =
      (level: string) =>
      (message: unknown): void => {
        lines.push(`${level} ${String(message)}`);
      };
    host.warn = at("warn") as typeof host.warn;
    host.error = at("error") as typeof host.error;
    return lines;
  }

  /** The mirrored lines of one event, named after the plugin's own prefix. */
  const written = (lines: string[], event: string): string[] =>
    lines.filter((line) => line.includes(`] ${event} `));

  it("keeps a refused chat's journal level with what it actually means", async () => {
    // Both classes once wrote an ERROR pair per attestation, and a day of one
    // stand read as twelve identical incidents: the identity subagent routing
    // owns is a correct answer about another conversation, while a chat the
    // deployment cannot stand an agent behind is the operator's problem.
    const { ctx, surface, routeSession, stopResuming, dispose } = await world();
    const lines = mirrorLevels(ctx);
    routeSession("expert-1");
    await expect(surface.secureSession("", "expert-1")).rejects.toThrow(
      /\(reason: subagent-session\)$/u,
    );
    expect(written(lines, "session.agent-owned-by-routing")).toEqual([
      expect.stringMatching(
        /^warn \[dsh-qa-surface\] session\.agent-owned-by-routing/u,
      ),
    ]);
    expect(written(lines, "lockdown.rejected")).toEqual([
      expect.stringMatching(
        /^warn \[dsh-qa-surface\] lockdown\.rejected.*subagent-session/u,
      ),
    ]);

    lines.length = 0;
    stopResuming();
    await expect(surface.secureSession("", "chat-1")).rejects.toThrow(
      /\(reason: agent-unavailable\)$/u,
    );
    expect(written(lines, "session.agent-resolve-rejected")).toEqual([
      expect.stringMatching(
        /^error \[dsh-qa-surface\] session\.agent-resolve-rejected/u,
      ),
    ]);
    expect(written(lines, "lockdown.rejected")).toEqual([
      expect.stringMatching(
        /^error \[dsh-qa-surface\] lockdown\.rejected.*agent-unavailable/u,
      ),
    ]);
    await dispose();
  });

  /** One turn the Host closed with the registry refusal of the report. */
  function failedTurn(sessionId: string, turn: number): [unknown, unknown] {
    return [
      { id: sessionId, requestHeader: () => undefined },
      {
        type: "turn/end",
        data: {
          turn,
          reason: {
            kind: "error",
            error: {
              code: "NO_ADAPTER",
              message: 'pi-ai adapter does not own provider "local-dev"',
            },
          },
        },
      },
    ];
  }

  function turnLines(lines: string[]): string[] {
    return lines.filter((line) => line.includes("session.turn-failed"));
  }

  it("writes the failure of an attested chat with its code and provider", async () => {
    const { ctx, chat, surface, dispose } = await world();
    chat("chat-1", WORKSPACE);
    await surface.secureSession("", "chat-1");
    const lines = mirrorErrors(ctx);
    ctx.events.emit("session/event", ...failedTurn("chat-1", 3));
    expect(turnLines(lines)).toEqual([
      expect.stringMatching(
        /sessionId=chat-1 turn=3 code=NO_ADAPTER provider=local-dev/u,
      ),
    ]);
    await dispose();
  });

  it("files the death of a delegated expert under the chat that owns it", async () => {
    const { ctx, chat, surface, dispose } = await world();
    chat("chat-1", WORKSPACE);
    await surface.secureSession("", "chat-1");
    // The expert is created under the chat, which is how the ownership map —
    // installed by the approval, question and delete seams — learns the pair.
    // The shape is the one the Host gives a child, because the other listeners
    // of `session/created` read the conversation through it too.
    ctx.events.emit("session/created", {
      id: "expert-7",
      header: {
        id: "expert-7",
        createdAt: Date.now(),
        parentSession: "chat-1",
      },
      surface: { nodes: [] },
      snapshotEvents: () => [],
      eventAt: () => undefined,
    });
    const lines = mirrorErrors(ctx);
    ctx.events.emit("session/event", ...failedTurn("expert-7", 3));
    expect(turnLines(lines)).toEqual([
      expect.stringMatching(
        /sessionId=chat-1 failedSessionId=expert-7 turn=3 code=NO_ADAPTER/u,
      ),
    ]);
    await dispose();
  });

  it("keeps a session this deployment does not claim out of the log", async () => {
    const { ctx, chat, surface, dispose } = await world();
    chat("chat-1", WORKSPACE);
    await surface.secureSession("", "chat-1");
    const lines = mirrorErrors(ctx);
    ctx.events.emit("session/event", ...failedTurn("foreign-1", 1));
    expect(turnLines(lines)).toEqual([]);
    await dispose();
  });
});
