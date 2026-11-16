import type { Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { ContextSnapshotSection, UserMessage } from "@deepseek-ai/dsh-llm";
import type { Session } from "@deepseek-ai/dsh-session";
import type {} from "../prompt-notes.js";

/**
 * Latest QA note text by section name on the active surface and in the proposed
 * batch. Shadowed history and abandoned proposals do not count as retained.
 */
export function retainedQaNotes(
  session: Pick<Session, "surface" | "eventAt">,
  proposed: readonly UserMessage[] = [],
): ReadonlyMap<string, string> {
  const notes = new Map<string, string>();
  const collect = ({ source }: UserMessage): void => {
    if (source.kind !== "qa-notes" || source.form !== "snapshot") return;
    for (const section of source.sections)
      notes.set(section.name, section.text);
  };
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq);
    if (event?.type === "user/message") collect(event.data);
  }
  for (const message of proposed) collect(message);
  return notes;
}

function noteMessage(note: ContextSnapshotSection): UserMessage {
  return createUserMessage({
    content: [{ type: "text", text: note.text }],
    source: { kind: "qa-notes", form: "snapshot", sections: [note] },
  });
}

/** Reconciles QA notes at pre-step and after request-time compaction/retries. */
export class QaNoteAdmission {
  private readonly steps = new WeakMap<
    Agent,
    {
      notes: readonly ContextSnapshotSection[];
      pending: readonly UserMessage[];
    }
  >();
  private readonly stopRequest: () => void;
  private disposed = false;

  constructor(ctx: Context) {
    // Wrap the Host's route-change compaction so restoration sees its final
    // surface. Overflow retries re-enter request preparation without pre-step.
    this.stopRequest = ctx.on(
      "agent/request",
      async ({ agent, signal }, next) => {
        const request = await next();
        const step = this.steps.get(agent);
        if (this.disposed || signal.aborted || step === undefined)
          return request;
        const carried = retainedQaNotes(agent.session, step.pending);
        for (const note of step.notes) {
          if (carried.get(note.name) !== note.text)
            agent.session.append("user/message", noteMessage(note), {
              surfaceOp: "append",
            });
        }
        // The loop admits this first batch after preparation. On a retry it is
        // already committed, so only the retained surface can supply the notes.
        step.pending = [];
        return request;
      },
      { prepend: true, global: true },
    );
  }

  /** Propose missing or changed notes without treating a proposal as retained. */
  propose(
    agent: Agent,
    decision: Extract<PreStepDecision, { kind: "enter" }>,
    notes: readonly ContextSnapshotSection[],
  ): Extract<PreStepDecision, { kind: "enter" }> {
    if (this.disposed) return decision;
    const carried = retainedQaNotes(agent.session, decision.messages);
    const additions = notes.filter(
      (note) => carried.get(note.name) !== note.text,
    );
    const messages =
      additions.length === 0
        ? decision.messages
        : [...decision.messages, ...additions.map(noteMessage)];
    this.steps.set(agent, { notes, pending: messages });
    return additions.length === 0 ? decision : { ...decision, messages };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopRequest();
  }
}
