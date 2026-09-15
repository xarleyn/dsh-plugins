import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { SkillSummary } from "@deepseek-ai/dsh-skill";
import type {
  QaCapabilityDescriptor,
  QaCapabilitySourceKind,
} from "../types.js";

export interface CapabilityCatalogSnapshot {
  readonly descriptors: readonly QaCapabilityDescriptor[];
  readonly toolIds: ReadonlySet<string>;
  readonly skillIds: ReadonlySet<string>;
  readonly skills: ReadonlyMap<string, SkillSummary>;
}

function toolSource(name: string): {
  readonly kind: QaCapabilitySourceKind;
  readonly name?: string;
} {
  if (name.startsWith("mcp__")) {
    const server = name.slice(5).split("__", 1)[0];
    return { kind: "mcp", ...(server === "" ? {} : { name: server }) };
  }
  if (name.startsWith("qa_") || name.startsWith("document_")) {
    return { kind: "plugin", name: "dsh-qa-surface" };
  }
  return { kind: "core" };
}

function skillSource(skill: SkillSummary): QaCapabilityDescriptor["source"] {
  const kind: QaCapabilitySourceKind =
    skill.provider.includes("filesystem") || skill.source.includes("project")
      ? "filesystem"
      : skill.source === "runtime"
        ? "runtime"
        : "plugin";
  return { kind, name: skill.provider || skill.source };
}

/** Read-only adapter over the current DSH registries. */
export class QaCapabilityCatalog {
  constructor(
    private readonly ctx: Context,
    private readonly additionalToolNames: () => readonly string[] = () => [],
  ) {}

  async snapshot(agent?: Agent): Promise<CapabilityCatalogSnapshot> {
    const toolDescriptors: QaCapabilityDescriptor[] = this.ctx.tools
      .schemas(agent)
      .map((schema) => ({
        type: "tool" as const,
        id: schema.name,
        title: schema.name,
        ...(schema.description === undefined
          ? {}
          : { description: schema.description }),
        source: toolSource(schema.name),
        status: "available" as const,
      }));
    const mountedToolIds = new Set(toolDescriptors.map(({ id }) => id));
    for (const id of this.additionalToolNames()) {
      if (mountedToolIds.has(id)) continue;
      mountedToolIds.add(id);
      toolDescriptors.push({
        type: "tool",
        id,
        title: id,
        source: toolSource(id),
        status: "available",
      });
    }

    const registry = this.ctx.get("skills") as Context["skills"] | undefined;
    const skillList =
      registry === undefined
        ? []
        : (
            await registry.snapshot({
              ...(agent === undefined ? {} : { scope: agent }),
              ...(agent?.session.header.cwd === undefined
                ? {}
                : { cwd: agent.session.header.cwd }),
            })
          ).skills;
    const skills = new Map(skillList.map((skill) => [skill.name, skill]));
    const skillDescriptors: QaCapabilityDescriptor[] = skillList.map(
      (skill) => ({
        type: "skill",
        id: skill.name,
        title: skill.name,
        description: skill.description,
        source: skillSource(skill),
        status: "available",
        modelInvocable: skill.invocation.modelInvocable,
        userInvocable: skill.invocation.userInvocable,
      }),
    );
    const descriptors = [...toolDescriptors, ...skillDescriptors].sort(
      (left, right) =>
        left.type.localeCompare(right.type) || left.id.localeCompare(right.id),
    );
    return Object.freeze({
      descriptors: Object.freeze(descriptors),
      toolIds: new Set(toolDescriptors.map(({ id }) => id)),
      skillIds: new Set(
        skillList
          .filter(({ invocation }) => invocation.modelInvocable)
          .map(({ name }) => name),
      ),
      skills,
    });
  }
}

export function withMissingCapabilities(
  descriptors: readonly QaCapabilityDescriptor[],
  configuredTools: readonly string[],
  configuredSkills: readonly string[],
): readonly QaCapabilityDescriptor[] {
  const keys = new Set(descriptors.map(({ type, id }) => `${type}:${id}`));
  const missing: QaCapabilityDescriptor[] = [];
  for (const id of configuredTools) {
    if (!keys.has(`tool:${id}`)) {
      missing.push({
        type: "tool",
        id,
        title: id,
        source: { kind: "plugin" },
        status: "missing",
      });
    }
  }
  for (const id of configuredSkills) {
    if (!keys.has(`skill:${id}`)) {
      missing.push({
        type: "skill",
        id,
        title: id,
        source: { kind: "plugin" },
        status: "missing",
      });
    }
  }
  return Object.freeze([...descriptors, ...missing]);
}
