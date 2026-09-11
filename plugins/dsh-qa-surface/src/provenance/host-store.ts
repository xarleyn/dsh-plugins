import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import {
  KNOWN_SESSION_EVENT_TYPES,
  SessionId,
  type Session,
  type SessionEvent,
} from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { QaSourceCollector } from "./collector.js";
import { createDefaultSourceExtractorRegistry } from "./extractors.js";
import { normalizeReportedSource } from "./reported.js";
import type {
  QaReportedSource,
  QaSourceOrigin,
  QaSourceReference,
  QaTurnSources,
} from "./types.js";
import type { ResolvedQaSurfaceConfig } from "../types.js";

const QA_SOURCES_EVENT = "qa/sources" as const;
export const QA_REPORT_SOURCES_TOOL = "qa_report_sources";

declare module "@deepseek-ai/dsh-session" {
  interface SessionEventMap {
    "qa/sources": QaTurnSources;
  }
}

interface SubagentInfo {
  readonly runId: string;
  readonly provider: string;
  readonly id: string;
  readonly local: boolean;
}

declare module "@deepseek-ai/cordis" {
  interface Events {
    "subagent/start"(info: SubagentInfo): void;
    "subagent/end"(info: SubagentInfo): void;
  }
}

interface ToolCallRecord {
  readonly turn: number;
  readonly step: number;
  readonly callId: string;
  readonly name: string;
  readonly args: unknown;
}

interface LineageRecord extends SubagentInfo {
  readonly parentSessionId: string;
  readonly rootSessionId: string;
  readonly rootTurn: number;
  reported: boolean;
}

function eventCallId(event: SessionEvent<"tool/result">): string | undefined {
  const block = event.data.message.content[0] as unknown as {
    readonly callId?: unknown;
  };
  return typeof block.callId === "string" ? block.callId : undefined;
}

function eventResult(event: SessionEvent<"tool/result">): unknown {
  const block = event.data.message.content[0] as unknown as {
    readonly content?: unknown;
  };
  return block.content ?? event.data.message.content;
}

function currentTurn(session: Session): number {
  let turn = 0;
  for (const event of session.snapshotEvents()) {
    if (event.type === "turn/start") turn = event.data.turn;
  }
  return turn;
}

function inheritedSource(
  source: QaSourceReference,
  lineage: LineageRecord,
): QaSourceReference {
  return {
    ...source,
    evidence: "inherited",
    origins: source.origins.map((origin) => ({
      ...origin,
      role: "subagent",
      subagentRunId: lineage.runId,
      subagentSessionId: lineage.id,
    })),
  };
}

function stringRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Host authority for collection, replay, delegation inheritance and snapshots. */
export class QaProvenanceHost {
  private readonly collectors = new Map<
    string,
    Map<number, QaSourceCollector>
  >();
  private readonly snapshots = new Map<string, Map<number, QaTurnSources>>();
  private readonly calls = new Map<string, Map<string, ToolCallRecord>>();
  private readonly lineage = new Map<string, LineageRecord>();
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly ctx: Context,
    private readonly config: () => ResolvedQaSurfaceConfig,
  ) {
    const known = KNOWN_SESSION_EVENT_TYPES as Set<string>;
    const ownedEventRegistration = !known.has(QA_SOURCES_EVENT);
    known.add(QA_SOURCES_EVENT);
    if (ownedEventRegistration)
      this.disposers.push(() => known.delete(QA_SOURCES_EVENT));

    for (const session of ctx.sessions.list()) this.seed(session);
    this.disposers.push(
      ctx.on("session/created", (session) => this.seed(session), {
        global: true,
      }),
      ctx.on(
        "session/event",
        (session, event) => this.observeEvent(session, event),
        { global: true },
      ),
      ctx.on(
        "agent/turn-stopping",
        ({ agent, turn }) => this.materialize(agent, turn),
        { global: true },
      ),
      ctx.on("subagent/start", (info) => this.startSubagent(info), {
        global: true,
      }),
      ctx.on("subagent/end", (info) => this.endSubagent(info), {
        global: true,
      }),
    );
    this.registerReportTool();
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }

  bundles(sessionId: string): readonly QaTurnSources[] {
    const session = this.ctx.sessions.get(SessionId(sessionId));
    if (session !== undefined) this.seed(session);
    const turns = new Set<number>([
      ...(this.collectors.get(sessionId)?.keys() ?? []),
      ...(this.snapshots.get(sessionId)?.keys() ?? []),
    ]);
    return [...turns]
      .sort((left, right) => left - right)
      .map(
        (turn) =>
          this.collectors.get(sessionId)?.get(turn)?.snapshot() ??
          this.snapshots.get(sessionId)?.get(turn),
      )
      .filter((bundle): bundle is QaTurnSources => bundle !== undefined);
  }

  sourceAllowed(sessionId: string, path: string): boolean {
    return this.bundles(sessionId).some((bundle) =>
      bundle.sources.some((source) => source.path === path),
    );
  }

  private seed(session: Session): void {
    if (
      this.snapshots.has(String(session.id)) ||
      this.collectors.has(String(session.id))
    )
      return;
    for (const event of session.snapshotEvents())
      this.observeEvent(session, event);
  }

  private observeEvent(session: Session, event: SessionEvent): void {
    const sessionId = String(session.id);
    if (event.type === QA_SOURCES_EVENT) {
      this.sessionSnapshots(sessionId).set(event.data.turn, event.data);
      return;
    }
    if (event.type === "tool/call") {
      this.sessionCalls(sessionId).set(String(event.data.callId), {
        turn: event.data.turn,
        step: event.data.step,
        callId: String(event.data.callId),
        name: event.data.name,
        args: event.data.arguments,
      });
      return;
    }
    if (event.type !== "tool/result" || event.data.error !== undefined) return;
    const callId = eventCallId(event);
    const call =
      callId === undefined
        ? undefined
        : this.sessionCalls(sessionId).get(callId);
    if (call === undefined || !this.shouldCollect(session)) return;
    this.collector(sessionId, call.turn).observe({
      toolName: call.name,
      args: call.args,
      result: eventResult(event),
      presentation: event.data.meta,
      origin: {
        sessionId,
        turn: call.turn,
        step: call.step,
        toolCallId: call.callId,
        toolName: call.name,
        agentId: sessionId,
        role: session.header.origin === "subagent" ? "subagent" : "parent",
      },
      ...(session.header.cwd === undefined
        ? {}
        : { workspaceRoot: session.header.cwd }),
    });
  }

  private shouldCollect(session: Session): boolean {
    const config = this.config().sources;
    return (
      config.enabled &&
      (session.header.origin === "subagent"
        ? config.collect.subagents
        : config.collect.parentAgent)
    );
  }

  private materialize(agent: Agent, turn: number): void {
    const config = this.config().sources;
    if (!config.enabled || !config.collect.persistTurnEvent) return;
    const bundle = this.collector(String(agent.id), turn).snapshot();
    const previous = this.snapshots.get(String(agent.id))?.get(turn);
    if (JSON.stringify(previous) === JSON.stringify(bundle)) return;
    agent.session.append(QA_SOURCES_EVENT, bundle);
  }

  private startSubagent(info: SubagentInfo): void {
    const config = this.config().sources;
    if (!config.enabled || !config.collect.subagents) return;
    const child = this.ctx.sessions.get(SessionId(info.id));
    const initiatingParent = this.ctx.agents.currentInitiator();
    const parentId =
      child?.header.parentSession === undefined
        ? initiatingParent === undefined
          ? undefined
          : String(initiatingParent.id)
        : String(child.header.parentSession);
    if (parentId === undefined) return;
    const parentLineage = this.lineage.get(parentId);
    const parent = this.ctx.sessions.get(SessionId(parentId));
    const lineage: LineageRecord = {
      ...info,
      parentSessionId: parentId,
      rootSessionId: parentLineage?.rootSessionId ?? parentId,
      rootTurn:
        parentLineage?.rootTurn ??
        (parent === undefined ? 0 : currentTurn(parent)),
      reported: false,
    };
    this.lineage.set(info.id, lineage);
    if (child !== undefined) this.seed(child);
  }

  private endSubagent(info: SubagentInfo): void {
    const lineage = this.lineage.get(info.id);
    if (lineage === undefined) return;
    const config = this.config().sources.subagents;
    const root = this.collector(lineage.rootSessionId, lineage.rootTurn);
    if (info.local && config.inheritSources) {
      for (const bundle of this.bundles(info.id)) {
        root.add(
          bundle.sources.map((source) => inheritedSource(source, lineage)),
        );
        if (!bundle.complete) {
          for (const incomplete of bundle.incompleteOrigins ?? [])
            root.markIncomplete(incomplete);
        }
      }
    } else if (!lineage.reported && config.markIncompleteOpaqueRuns) {
      root.markIncomplete({
        subagentRunId: lineage.runId,
        provider: lineage.provider,
        reason:
          "delegated provider did not expose structured source provenance",
      });
    }
  }

  private registerReportTool(): void {
    if (!this.config().sources.subagents.enableReportToolFallback) return;
    const definition = defineTool({
      name: QA_REPORT_SOURCES_TOOL,
      description:
        "Report the structured sources used by this delegated run so the parent QA answer can show provenance.",
      parameters: {
        sources: {
          type: "array",
          required: true,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: {
                type: "string",
                enum: [
                  "file",
                  "code",
                  "web",
                  "jira",
                  "confluence",
                  "knowledge",
                  "other",
                ],
                required: true,
              },
              title: { type: "string", required: true },
              uri: { type: "string" },
              path: { type: "string" },
              snippet: { type: "string" },
              locations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    path: { type: "string" },
                    lineStart: { type: "integer" },
                    lineEnd: { type: "integer" },
                    anchor: { type: "string" },
                    jiraKey: { type: "string" },
                    confluencePageId: { type: "string" },
                  },
                },
              },
              metadata: { type: "json" },
            },
          },
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { accepted: { type: "integer" } },
        },
        render: (_args, value) => [
          { type: "text", text: `Recorded ${value.accepted ?? 0} source(s).` },
        ],
      },
      execute: async (args, exec) => {
        const childId =
          exec.agent === undefined ? undefined : String(exec.agent.id);
        if (childId === undefined) return { accepted: 0 };
        const lineage = this.lineage.get(childId);
        if (lineage === undefined) return { accepted: 0 };
        const child = this.ctx.sessions.get(SessionId(childId));
        const turn = child === undefined ? 0 : currentTurn(child);
        const sourceConfig = this.config().sources;
        const origin: QaSourceOrigin = {
          sessionId: childId,
          turn,
          toolCallId: String(exec.callId),
          toolName: QA_REPORT_SOURCES_TOOL,
          agentId: childId,
          role: "subagent",
          subagentRunId: lineage.runId,
          subagentSessionId: childId,
        };
        const normalized = (args.sources as unknown[]).flatMap((candidate) => {
          const raw = stringRecord(candidate) as QaReportedSource | undefined;
          if (
            raw === undefined ||
            typeof raw.kind !== "string" ||
            typeof raw.title !== "string"
          )
            return [];
          const source = normalizeReportedSource(
            raw,
            origin,
            child?.header.cwd,
            {
              normalize: sourceConfig.dedupe.normalizeUrls,
              stripTrackingParams: sourceConfig.dedupe.stripTrackingParams,
            },
          );
          return source === null ? [] : [source];
        });
        this.collector(lineage.rootSessionId, lineage.rootTurn).add(normalized);
        lineage.reported = normalized.length > 0;
        return { accepted: normalized.length };
      },
    });
    this.disposers.push(this.ctx.tools.register(definition));
  }

  private collector(sessionId: string, turn: number): QaSourceCollector {
    const byTurn =
      this.collectors.get(sessionId) ?? new Map<number, QaSourceCollector>();
    this.collectors.set(sessionId, byTurn);
    let collector = byTurn.get(turn);
    if (collector === undefined) {
      const sourceConfig = this.config().sources;
      collector = new QaSourceCollector({
        sessionId,
        turn,
        registry: createDefaultSourceExtractorRegistry(
          sourceConfig.webSearch.promoteSearchResultsWithoutFetch
            ? sourceConfig.webSearch.maxPromotedPerSearch
            : 0,
          {
            normalize: sourceConfig.dedupe.normalizeUrls,
            stripTrackingParams: sourceConfig.dedupe.stripTrackingParams,
          },
        ),
        mergeFileRanges: sourceConfig.dedupe.mergeFileRanges,
      });
      const snapshot = this.snapshots.get(sessionId)?.get(turn);
      if (snapshot !== undefined) {
        collector.add([...snapshot.sources, ...(snapshot.discovered ?? [])]);
        for (const incomplete of snapshot.incompleteOrigins ?? [])
          collector.markIncomplete(incomplete);
      }
      byTurn.set(turn, collector);
    }
    return collector;
  }

  private sessionCalls(sessionId: string): Map<string, ToolCallRecord> {
    const calls =
      this.calls.get(sessionId) ?? new Map<string, ToolCallRecord>();
    this.calls.set(sessionId, calls);
    return calls;
  }

  private sessionSnapshots(sessionId: string): Map<number, QaTurnSources> {
    const snapshots =
      this.snapshots.get(sessionId) ?? new Map<number, QaTurnSources>();
    this.snapshots.set(sessionId, snapshots);
    return snapshots;
  }
}
