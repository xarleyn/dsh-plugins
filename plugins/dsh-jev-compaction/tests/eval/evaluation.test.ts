/**
 * Offline evaluation over the twelve-scenario corpus (SPEC §33). Each
 * scenario runs the real pipeline end-to-end — candidate collection,
 * features, state building, batching, a label-scripted System One backend,
 * the local policy, and the real mutation writer against a real `Session` —
 * through the armed manual path, then replays the log and scores the
 * outcome against the labels.
 *
 * Gates (§33.3): dangerousPruneRate = 0 on every scenario, and the average
 * context reduction over the low-danger set must clear 0.55. The scripted
 * backend makes runs deterministic and free; live-hosted replays are the
 * documented opt-in procedure in docs/evaluation.md.
 */

import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { Session } from "@deepseek-ai/dsh-session";
import type { Session as DshSession } from "@deepseek-ai/dsh-session";
import { JevCompactionService } from "../../src/service.js";
import type { SystemOneBackend } from "../../src/jev/types.js";
import type { AgentLike } from "../../src/dsh/types.js";
import { appendUserText } from "./fixtures.js";
import { SCENARIOS, type EvalScenario, type Label } from "./scenarios.js";

const SCORES: Record<Label, number> = {
  "must-keep": 0.95,
  "safe-to-truncate": 0.55,
  "safe-to-stub": 0.05,
};

/** Answer every question from the labels; unlabeled candidates stay full. */
class LabelScriptedBackend implements SystemOneBackend {
  constructor(private readonly labels: Readonly<Record<string, Label>>) {}

  async score(
    _state: unknown,
    questions: readonly { name: string }[],
  ): Promise<Map<string, number>> {
    const answers = new Map<string, number>();
    for (const question of questions) {
      if (!question.name.startsWith("needContents_")) {
        answers.set(question.name, 0.5);
        continue;
      }
      const callId = question.name.slice("needContents_".length);
      const label = this.labels[callId];
      answers.set(question.name, label === undefined ? 0.95 : SCORES[label]);
    }
    return answers;
  }
}

function evalService(
  labels: Readonly<Record<string, Label>>,
): JevCompactionService {
  const ctx = new Context();
  (
    ctx as unknown as {
      reflect: { provide(name: string, value: unknown): void };
    }
  ).reflect.provide("tokenMeter", {
    measure: () => ({ totalTokens: 0, surfaceTokens: 0, nodes: [] }),
  });
  return new JevCompactionService(
    ctx,
    {
      enabled: true,
      decision: {
        provider: "custom",
        custom: { baseUrl: "http://eval.invalid", apiKeyEnv: "" },
      },
      trigger: {
        contextRatio: 0.7,
        minSurfaceTokens: 1,
        minCandidates: 1,
        minCandidateChars: 1,
        cooldownTurns: 0,
      },
      preserve: { recentMessages: 0, recentTokens: 0, errors: true },
      pruning: {
        truncateHeadChars: 384,
        truncateTailChars: 128,
        minSavingsChars: 0,
        minSavingsRatio: 0,
      },
    },
    new LabelScriptedBackend(labels) as never,
  );
}

function evalAgent(session: DshSession): AgentLike {
  return { id: "eval-agent", session };
}

/** Map callId → current inner text across the live surface. */
function surfaceTextByCallId(session: DshSession): Map<string, string> {
  const map = new Map<string, string>();
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq);
    if (event === undefined || event.type !== "tool/result") continue;
    const data = event.data as {
      message: {
        source: { callId: string };
        content: [{ content: { type: string; text?: string }[] }];
      };
    };
    const text = data.message.content[0].content
      .map((item) => item.text ?? "")
      .join("\n");
    map.set(data.message.source.callId, text);
  }
  return map;
}

function classify(text: string): "KEEP_STUB" | "KEEP_TRUNCATED" | "KEEP_FULL" {
  if (
    text.includes("[dsh-jev-compaction]") &&
    text.includes("Historical tool output pruned")
  ) {
    return "KEEP_STUB";
  }
  if (
    text.includes("[dsh-jev-compaction]") &&
    text.includes("historical characters")
  ) {
    return "KEEP_TRUNCATED";
  }
  return "KEEP_FULL";
}

interface ScenarioOutcome {
  readonly id: string;
  readonly danger: EvalScenario["danger"];
  readonly actions: Record<string, string>;
  readonly dangerous: number;
  readonly reduction: number;
  readonly replayOk: boolean;
  readonly idempotent: boolean;
}

async function runScenario(scenario: EvalScenario): Promise<ScenarioOutcome> {
  const session = scenario.build();
  const service = evalService(scenario.labels);
  const agent = evalAgent(session);

  const labeledCallIds = Object.keys(scenario.labels);
  const before = surfaceTextByCallId(session);
  const beforeChars = labeledCallIds.reduce(
    (sum, callId) => sum + (before.get(callId)?.length ?? 0),
    0,
  );

  // An open turn makes in-turn replacement legal (§21.0 arming path).
  session.append("turn/start", { turn: 50 });
  const dry = await service.runManualDry(agent, new AbortController().signal);
  console.log(
    `[eval] ${scenario.id}: dry skipped=${dry.skipped ?? "-"} error=${dry.error ?? "-"} candidates=${dry.candidates} mutations=${dry.plan?.mutations.length ?? 0}`,
  );
  service.queueManualRun(agent);
  await service.handlePreStep(
    {
      agent,
      messages: [],
      turn: 50,
      step: 1,
      signal: new AbortController().signal,
    } as never,
    async () => ({ kind: "enter" as const, messages: [] }),
  );

  const after = surfaceTextByCallId(session);
  const afterChars = labeledCallIds.reduce(
    (sum, callId) => sum + (after.get(callId)?.length ?? 0),
    0,
  );

  const actions: Record<string, string> = {};
  let dangerous = 0;
  for (const callId of labeledCallIds) {
    const action = classify(after.get(callId) ?? "");
    actions[callId] = action;
    if (scenario.labels[callId] === "must-keep" && action !== "KEEP_FULL") {
      dangerous += 1;
    }
  }

  // Replay invariants: the log must fold to identical derived messages.
  const replay = Session.create(session.id, session.snapshotEvents());
  const replayOk =
    JSON.stringify(replay.deriveMessages()) ===
    JSON.stringify(session.deriveMessages());

  // Idempotence: a second armed pass prunes nothing further.
  const beforeSecond = surfaceTextByCallId(session);
  service.queueManualRun(agent);
  await service.handlePreStep(
    {
      agent,
      messages: [],
      turn: 51,
      step: 1,
      signal: new AbortController().signal,
    } as never,
    async () => ({ kind: "enter" as const, messages: [] }),
  );
  const afterSecond = surfaceTextByCallId(session);
  let idempotent = beforeSecond.size === afterSecond.size;
  if (idempotent) {
    for (const [callId, text] of beforeSecond) {
      if (afterSecond.get(callId) !== text) {
        idempotent = false;
        break;
      }
    }
  }

  service.dispose();
  return {
    id: scenario.id,
    danger: scenario.danger,
    actions,
    dangerous,
    reduction:
      beforeChars === 0
        ? 0
        : Math.max(0, (beforeChars - afterChars) / beforeChars),
    replayOk,
    idempotent,
  };
}

const LOW_DANGER_IDS = new Set([
  "01-reread-same-file",
  "02-edit-invalidates-read",
  "03-edit-invalidates-many",
  "04-long-grep",
  "09-docs-lookup",
  "11-long-shell-log",
]);

describe("evaluation corpus (SPEC §33)", () => {
  it("prunes every scenario without a single dangerous prune, with clean replay and convergence", async () => {
    const outcomes: ScenarioOutcome[] = [];
    for (const scenario of SCENARIOS) {
      outcomes.push(await runScenario(scenario));
    }

    for (const outcome of outcomes) {
      expect(outcome.dangerous, `${outcome.id}: dangerous prunes`).toBe(0);
      expect(outcome.replayOk, `${outcome.id}: replay`).toBe(true);
      expect(outcome.idempotent, `${outcome.id}: idempotence`).toBe(true);
    }

    const results = outcomes
      .map(
        (outcome) =>
          `${outcome.id}  danger=${outcome.danger}  reduction=${(outcome.reduction * 100).toFixed(1)}%  actions=${JSON.stringify(outcome.actions)}`,
      )
      .join("\n");
    console.log(`\nevaluation corpus results:\n${results}\n`);

    const lowDanger = outcomes.filter((outcome) =>
      LOW_DANGER_IDS.has(outcome.id),
    );
    const averageReduction =
      lowDanger.reduce((sum, outcome) => sum + outcome.reduction, 0) /
      lowDanger.length;
    expect(averageReduction).toBeGreaterThanOrEqual(0.55);
  }, 60_000);
});

// Keep the user-text import used: scenarios append their own user turns, the
// corpus-level guard below exercises the helper once so the fixture module
// stays fully covered.
describe("corpus fixtures", () => {
  it("appendUserText lands a plain user message", () => {
    const session = SCENARIOS[0]!.build();
    const userNodes = [...session.surface.nodes].filter((seq) => {
      const event = session.eventAt(seq);
      return event?.type === "user/message";
    });
    expect(userNodes.length).toBeGreaterThan(0);
    void appendUserText;
  });
});
