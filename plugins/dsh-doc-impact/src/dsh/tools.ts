import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Impact } from '../impact/types.js';
import type { ResolveImpactInput } from '../impact/types.js';

interface SessionLike {
  readonly id: string;
  readonly header: { readonly cwd?: string } | undefined;
  readonly events: readonly { readonly type: string; readonly data: unknown }[];
}

interface ToolAgent {
  readonly id: string;
  readonly session: SessionLike;
}

interface ToolExec {
  readonly agent?: ToolAgent | undefined;
}

interface EngineFacade {
  resolve(
    sessionId: string,
    cwd: string,
    turn: number,
    input: ResolveImpactInput,
  ): Promise<{ resolved: number; remaining: Impact[] }>;
  status(
    sessionId: string,
    cwd: string,
    turn: number,
  ): Promise<{ pending: Impact[]; resolved: Impact[] }>;
}

export interface ToolContext {
  engine: EngineFacade;
}

function requireAgent(exec: ToolExec): ToolAgent {
  const agent = exec.agent;
  if (agent === undefined) {
    throw new Error('doc_impact tools require a calling agent');
  }
  const cwd = agent.session.header?.cwd;
  if (typeof cwd !== 'string' || cwd === '') {
    throw new Error('this session has no working directory; doc-impact is not active');
  }
  return agent;
}

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

/** Explicit resolution for strict modes (SPEC §29-§30). */
export function createResolveTool({ engine }: ToolContext) {
  return defineTool({
    name: 'doc_impact_resolve',
    description: [
      'Resolve a pending documentation impact detected by dsh-doc-impact.',
      'Call after reviewing (or updating) the linked documents named in the reminder.',
      'status "reviewed-current": the document is already accurate after your review;',
      'status "updated": you changed the target document(s);',
      'status "not-applicable": requires a non-empty reason explaining why the link does not apply.',
    ].join(' '),
    parameters: {
      ruleId: {
        type: 'string',
        required: true,
        description: 'The id of the triggered rule, as named in the documentation impact reminder.',
      },
      status: {
        type: 'string',
        required: true,
        enum: ['reviewed-current', 'updated', 'not-applicable'],
        description: 'The resolution being claimed for the impact.',
      },
      reason: {
        type: 'string',
        description: 'Required for "not-applicable": why this rule does not apply to the current change.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resolved: { type: 'integer', required: true },
          remainingCount: { type: 'integer', required: true },
          remaining: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ruleId: { type: 'string', required: true },
                status: {
                  type: 'string',
                  required: true,
                  enum: ['pending', 'updated', 'reviewed-current', 'not-applicable', 'superseded'],
                },
                targetFiles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            `Resolved ${value.resolved} impact(s); ${value.remainingCount} pending impact(s) remain.` +
            (value.remainingCount > 0
              ? '\nStill pending:\n' + value.remaining.map((impact: { ruleId: string }) => `- ${impact.ruleId}`).join('\n')
              : '\nAll documentation impacts are resolved; you may finish the task.'),
        },
      ],
    },
    async execute(args: unknown, exec: ToolExec) {
      const input = args as {
        ruleId: string;
        status: ResolveImpactInput['status'];
        reason?: string;
      };
      if (input.status === 'not-applicable' && (input.reason === undefined || input.reason.trim() === '')) {
        throw new Error('status "not-applicable" requires a non-empty reason');
      }
      const agent = requireAgent(exec);
      const cwd = agent.session.header?.cwd as string;
      const outcome = await engine.resolve(String(agent.id), cwd, currentTurn(agent.session.events), {
        ruleId: input.ruleId,
        status: input.status,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      });
      return {
        resolved: outcome.resolved,
        remainingCount: outcome.remaining.length,
        remaining: outcome.remaining.map((impact) => ({
          ruleId: impact.ruleId,
          status: impact.status,
          targetFiles: impact.targetFiles,
        })),
      };
    },
  });
}

/** Read-only status helper (SPEC §42); the reminder already carries the essentials. */
export function createStatusTool({ engine }: ToolContext) {
  return defineTool({
    name: 'doc_impact_status',
    description: 'Report documentation impacts currently tracked for this agent by dsh-doc-impact.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pending: { type: 'array', required: true, items: { type: 'string' } },
          resolved: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            `Documentation impacts — pending: ${value.pending.length}, resolved: ${value.resolved.length}.` +
            (value.pending.length > 0 ? '\nPending:\n' + value.pending.join('\n') : ''),
        },
      ],
    },
    async execute(_args: unknown, exec: ToolExec) {
      const agent = requireAgent(exec);
      const cwd = agent.session.header?.cwd as string;
      const turn = currentTurn(agent.session.events);
      const status = await engine.status(String(agent.id), cwd, turn);
      const label = (impact: Impact): string => `${impact.ruleId} [${impact.status}] → ${impact.targetFiles.join(', ')}`;
      return {
        pending: status.pending.map(label),
        resolved: status.resolved.map(label),
      };
    },
  });
}
