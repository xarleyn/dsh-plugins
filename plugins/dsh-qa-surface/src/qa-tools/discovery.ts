import type { Agent } from "@deepseek-ai/dsh-agent";
import { projectToolSchema, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { qaAgentScope } from "../agent-scope.js";
import {
  createFindTools,
  discoveryFamily,
  FIND_TOOLS,
  searchTools,
} from "./find-tools.js";

type Mode = "observe" | "search";

/** An additional restriction owned by one chat. The ordinary admission mask and all
 * execution/approval gates remain installed throughout its lifetime. */
export class QaToolDiscovery {
  private mask: (() => void) | undefined;
  private hidden = new Set<string>();
  private readonly opened: Set<string>;
  private readonly disposers: (() => void)[] = [];
  private finder?: ToolDefinition;
  private disposed = false;
  private ready = false;

  constructor(
    private readonly agent: Agent,
    readonly mode: Mode,
    private readonly inventory: ReadonlySet<string>,
    private readonly allowed: () => ReadonlySet<string>,
    private readonly logger: PluginLogger,
    restored: readonly string[] = [],
  ) {
    this.opened = new Set(restored);
    const { ctx } = agent;
    try {
      if (mode === "search") {
        this.finder = createFindTools(agent, (args) =>
          this.unmasked(() => {
            if (!this.ready || this.disposed)
              throw new Error("Tool discovery is unavailable.");
            const candidates = this.candidates();
            const page = searchTools(candidates, args);
            if (!args.browse)
              for (const { name } of page.matches) this.opened.add(name);
            this.hidden = this.toHide(candidates);
            const empty = page.matches.length === 0;
            return JSON.stringify({
              status: empty
                ? "no_matches"
                : args.browse
                  ? "listed"
                  : "available_next_step",
              matches: page.matches.map(({ name, description }) => ({
                name,
                description: description.slice(0, 160),
              })),
              nextOffset: page.nextOffset,
              ...(empty
                ? {
                    hint: "No matches in this catalog. For Jira or Confluence, activate search-jira or search-confluence if needed. Then use the matching callable jira_* or confluence_* tool directly.",
                  }
                : {}),
            });
          }),
        );
        this.disposers.push(ctx.tools.register(this.finder));
      } else {
        // A provider returning no schemas observes the actual step-selected set,
        // without mutating its ordering, history or executor.
        this.disposers.push(
          ctx.systemPrompt.tools(({ scope, toolSet }) => {
            if (scope === agent && toolSet) {
              const all = ctx.tools.definitions(scope, toolSet);
              const deferred = this.candidates(all);
              this.logger.info("tool-discovery.observe", {
                schemas: all.length,
                deferred: deferred.length,
                schemaBytes: this.bytes(all),
                deferredBytes: this.bytes(deferred),
              });
            }
            return { schemas: [] };
          }),
        );
        this.disposers.push(
          ctx.on("tools/result", (exec) => {
            if (
              exec.agent === agent &&
              this.inventory.has(exec.name) &&
              this.allowed().has(exec.name)
            ) {
              const family = discoveryFamily(exec.name);
              if (family) this.logger.info("tool-discovery.used", { family });
            }
            return undefined;
          }),
        );
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private bytes(defs: readonly ToolDefinition[]): number {
    return Buffer.byteLength(
      JSON.stringify(defs.map((d) => projectToolSchema(d, false))),
    );
  }

  /** Only an exact owner-published name whose original global definition the
   * agent can see. A same-name local shadow or a role's unactivated grant is never indexed. */
  private candidates(
    defs = this.agent.ctx.tools.definitions(qaAgentScope(this.agent)),
  ) {
    const originals = new Set(this.agent.ctx.tools.definitions());
    const allowed = this.allowed();
    return defs.filter(
      (d) =>
        this.inventory.has(d.name) &&
        allowed.has(d.name) &&
        discoveryFamily(d.name) &&
        originals.has(d),
    );
  }

  private toHide(defs: readonly ToolDefinition[]) {
    return new Set(defs.map((d) => d.name).filter((n) => !this.opened.has(n)));
  }

  ownsFinder(agent: Agent | undefined): boolean {
    return (
      !this.disposed &&
      agent === this.agent &&
      this.finder !== undefined &&
      agent.ctx.tools.get(FIND_TOOLS, qaAgentScope(agent)) === this.finder
    );
  }

  /** Inspect synchronously under the original scoped policy; only this object's
   * narrowing is released. No await, execution, or external callback runs between
   * the lookup and reinstating the narrowing. An unavailable name stays unavailable. */
  unmasked<T>(read: () => T): T {
    this.mask?.();
    this.mask = undefined;
    try {
      return read();
    } finally {
      if (!this.disposed && this.hidden.size) {
        const mounted = new Set(
          this.agent.ctx.tools.definitions().map((d) => d.name),
        );
        const deny = [...this.hidden].filter((n) => mounted.has(n));
        if (deny.length) this.mask = this.agent.ctx.tools.restrict({ deny });
      }
    }
  }

  /** After admission or an integration change, keep any previously opened
   * names, intersecting with the current owner inventory and role every time. */
  refresh(granted: readonly string[] = []): void {
    if (!this.ready || this.mode !== "search" || this.disposed) return;
    this.unmasked(() => {
      const candidates = this.candidates();
      for (const { name } of candidates)
        if (granted.includes(name)) this.opened.add(name);
      this.hidden = this.toHide(candidates);
    });
  }

  start(): void {
    this.ready = true;
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.mask?.();
    this.mask = undefined;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }
}

/** Validate the actual executor's native presentation, not a preset name.
 * A PTC-only or custom executor without ordinary declarations keeps its own surface. */
export async function supportsDiscovery(
  agent: Agent,
  inventory: ReadonlySet<string>,
  mode: Mode,
) {
  const scope = qaAgentScope(agent);
  if (scope === undefined) return false;
  const result = await agent.ctx.systemPrompt.assemble({ agent, scope });
  return (
    !result.tools.some((t) => t.name === "run_code") &&
    (mode !== "search" || result.tools.some((t) => t.name === FIND_TOOLS)) &&
    result.tools.some((t) => inventory.has(t.name) && discoveryFamily(t.name))
  );
}
