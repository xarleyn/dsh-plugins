import type { FileChange } from '../changes/types.js';
import { buildReminderMessage, formatChanged, formatExplain, formatStatus } from '../engine/reminder.js';
import type { Impact } from '../impact/types.js';
import type { ImpactRule } from '../config/types.js';

interface SessionLike {
  readonly id: string;
  readonly header: { readonly cwd?: string } | undefined;
  readonly events: readonly { readonly type: string; readonly data: unknown }[];
}

interface InvocationAgent {
  readonly id: string;
  readonly session: SessionLike;
}

interface Invocation {
  readonly agent: InvocationAgent;
  readonly rawInput: string;
}

interface EngineFacade {
  check(
    sessionId: string,
    cwd: string,
    turn: number,
  ): Promise<{
    steer: string | undefined;
    pending: Impact[];
    changed: FileChange[];
    knownFiles: ReadonlySet<string>;
  }>;
  changedFiles(sessionId: string, cwd: string, turn: number): Promise<FileChange[]>;
  status(sessionId: string, cwd: string, turn: number): Promise<{ pending: Impact[]; resolved: Impact[] }>;
}

interface ConfigFacade {
  rulesFor(cwd: string): Promise<ImpactRule[]>;
}

const USAGE = [
  'Usage:',
  '  /doc-impact            — show current impact status',
  '  /doc-impact check      — recompute impacts for this agent now',
  '  /doc-impact explain <ruleId> — show one rule and whether it is triggered',
  '  /doc-impact changed    — files the plugin attributes to this agent',
].join('\n');

function currentTurn(events: SessionLike['events']): number {
  let turn = 0;
  for (const event of events) {
    if (event.type === 'turn/start') {
      const value = (event.data as { turn?: unknown }).turn;
      if (typeof value === 'number') turn = value;
    }
  }
  return turn;
}

/**
 * The `/doc-impact` command family (SPEC §41). Commands are an optional host
 * service, so the adapter registers through late `inject(['commands'])`.
 */
export function createDocImpactCommand(engine: EngineFacade, configFacade: ConfigFacade) {
  return {
    name: 'doc-impact',
    description: 'Documentation impact status and debugging (dsh-doc-impact plugin).',
    input: { hint: '[check|explain <ruleId>|changed]' },
    async handler(invocation: Invocation): Promise<{ kind: 'success' | 'error'; text: string }> {
      const agent = invocation.agent;
      const cwd = agent.session.header?.cwd;
      if (typeof cwd !== 'string' || cwd === '') {
        return { kind: 'error', text: 'This session has no working directory; dsh-doc-impact is not active.' };
      }
      const sessionId = String(agent.id);
      const turn = currentTurn(agent.session.events);

      const raw = invocation.rawInput.trim();
      if (raw === '') {
        const status = await engine.status(sessionId, cwd, turn);
        return { kind: 'success', text: formatStatus(status.pending, status.resolved) };
      }

      const [subcommand, argument = ''] = raw.split(/\s+/, 2);
      if (subcommand === 'check') {
        const decision = await engine.check(sessionId, cwd, turn);
        if (decision.pending.length === 0) {
          return { kind: 'success', text: 'No documentation impacts for the current changes.' };
        }
        return {
          kind: 'success',
          text: `${decision.pending.length} pending impact(s).\n\n${buildReminderMessage(decision.pending, decision.knownFiles, 'own')}`,
        };
      }
      if (subcommand === 'changed') {
        const changes = await engine.changedFiles(sessionId, cwd, turn);
        return { kind: 'success', text: formatChanged(changes) };
      }
      if (subcommand === 'explain') {
        const rules = await configFacade.rulesFor(cwd);
        if (rules.length === 0) {
          return { kind: 'error', text: `No dsh-doc-impact workspace config found under ${cwd}.` };
        }
        const rule = rules.find((candidate) => candidate.id === argument);
        if (rule === undefined) {
          return {
            kind: 'error',
            text: `Unknown rule ${JSON.stringify(argument)}. Configured rules: ${rules.map((candidate) => candidate.id).join(', ')}.`,
          };
        }
        const decision = await engine.check(sessionId, cwd, turn);
        return {
          kind: 'success',
          text: formatExplain(rule, decision.pending.some((impact) => impact.ruleId === rule.id)),
        };
      }
      return { kind: 'error', text: USAGE };
    },
  };
}
