import { resolveConfig } from "../../src/resolve-config.js";
import {
  QaPersonalSkills,
  type QaPersonalSkillContext,
} from "../../src/personal-skills/index.js";

export const USER_A = "123e4567-e89b-42d3-a456-426614174000";
export const USER_B = "223e4567-e89b-42d3-a456-426614174001";

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
} as never;

export function skillText(
  lines: readonly string[],
  body = "# Heading\n\n1. Step.",
): string {
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

export function serviceFor(options: {
  readonly workspace: string;
  readonly tools?: readonly string[];
  readonly allow?: readonly string[];
  readonly userId?: string;
  readonly maxSkillBytes?: number;
  readonly relativeRoot?: string;
}): {
  readonly service: QaPersonalSkills;
  readonly invalidations: () => number;
  readonly observed: () => readonly string[];
  readonly context: QaPersonalSkillContext;
} {
  const config = resolveConfig({
    session: { workspaceId: "workspace-1" },
    accounts: {
      enabled: true,
      perUserWorkspace: true,
      skills: {
        ...(options.relativeRoot === undefined
          ? {}
          : { relativeRoot: options.relativeRoot }),
        ...(options.maxSkillBytes === undefined
          ? {}
          : { maxSkillBytes: options.maxSkillBytes }),
      },
    },
    lockdown: {
      sandboxMode: "workspace-write",
      permissionPreset: "qa-workspace-write",
      toolPolicy: { allow: [...(options.allow ?? ["read", "grep"])] },
    },
    sources: { enabled: false },
  });
  let invalidations = 0;
  const observed: string[] = [];
  const context = {
    tools: {
      schemas: () =>
        (options.tools ?? ["read", "grep", "write"]).map((name) => ({
          name,
          description: `${name} tool`,
          parameters: {},
        })),
    },
  };
  return {
    service: new QaPersonalSkills(context as never, {
      getConfig: () => config,
      logger: silentLogger,
      workspacePath: () => options.workspace,
      invalidate: () => {
        invalidations += 1;
      },
      onRootDiscovered: (root) => {
        observed.push(root);
      },
    }),
    invalidations: () => invalidations,
    observed: () => observed,
    context: { userId: options.userId ?? USER_A },
  };
}
