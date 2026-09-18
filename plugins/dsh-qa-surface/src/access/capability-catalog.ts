import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { ScopeKey } from "@deepseek-ai/dsh-scope";
import type { SkillSummary } from "@deepseek-ai/dsh-skill";
import type {
  QaCapabilityDescriptor,
  QaCapabilitySourceKind,
  QaSkillDescriptor,
} from "../types.js";
import { parseQaSkillMetadata } from "./skill-metadata.js";

export interface CapabilityCatalogSnapshot {
  readonly descriptors: readonly QaCapabilityDescriptor[];
  readonly toolIds: ReadonlySet<string>;
  /** Installed skills a model-facing catalog may list. */
  readonly skillIds: ReadonlySet<string>;
  /** Installed skills a person may invoke, including model-hidden ones. */
  readonly userSkillIds: ReadonlySet<string>;
  readonly skills: ReadonlyMap<string, SkillSummary>;
  /** Normalized `metadata.qa-surface` of every discovered skill. */
  readonly skillMetadata: ReadonlyMap<string, QaSkillDescriptor>;
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
    /** Role ids used to report unknown subrole ids in skill metadata. */
    private readonly knownSubroles: () => readonly string[] = () => [],
    /**
     * The viewing scope an administrator's catalog is read with, for callers
     * that have no agent of their own. Skills and tools an agent preset mounts
     * (a kit's skill catalog, the preset's tool family) live in that preset's
     * scope, so a global-only read reported an almost empty catalog: the
     * administrator could neither see nor grant what every chat mounts.
     * Resolving the scope may compose the preset; a failure degrades to the
     * global view instead of failing the page.
     */
    private readonly presetScope: () => Promise<ScopeKey | undefined> = () =>
      Promise.resolve(undefined),
  ) {}

  async snapshot(agent?: Agent): Promise<CapabilityCatalogSnapshot> {
    const scope: ScopeKey | undefined =
      agent ?? (await this.resolvePresetScope());
    const toolDescriptors: QaCapabilityDescriptor[] = this.ctx.tools
      .schemas(scope)
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
    const lookup: { scope?: ScopeKey; cwd?: string } = {
      ...(scope === undefined ? {} : { scope }),
      ...(agent?.session.header.cwd === undefined
        ? {}
        : { cwd: agent.session.header.cwd }),
    };
    const skillList =
      registry === undefined ? [] : (await registry.snapshot(lookup)).skills;
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
      userSkillIds: new Set(
        skillList
          .filter(({ invocation }) => invocation.userInvocable)
          .map(({ name }) => name),
      ),
      skills,
      skillMetadata:
        registry === undefined
          ? new Map<string, QaSkillDescriptor>()
          : await this.readSkillMetadata(registry, skillList, lookup),
    });
  }

  /**
   * The scope an administrator's catalog is read with. A deployment that pins
   * QA chats to an agent preset gets that preset's standing scope; without a
   * pinned preset there is no scope to borrow, and the read stays global.
   */
  private async resolvePresetScope(): Promise<ScopeKey | undefined> {
    try {
      return await this.presetScope();
    } catch (error: unknown) {
      // A preset the deployment cannot compose is an operator problem this
      // page is not the place to surface: the global view is still readable.
      this.ctx.logger.warn(
        `qa-surface: could not resolve the QA preset scope for the capability catalog: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  /**
   * Read `metadata.qa-surface` of every discovered skill.
   *
   * The registry exposes metadata on loaded definitions only, so discovery has
   * to fetch each body once. A provider that fails or a skill that disappears
   * between the two reads degrades to the fail-closed descriptor instead of
   * failing the whole catalog.
   */
  private async readSkillMetadata(
    registry: Context["skills"],
    skillList: readonly SkillSummary[],
    lookup: { readonly scope?: ScopeKey; readonly cwd?: string },
  ): Promise<ReadonlyMap<string, QaSkillDescriptor>> {
    const known = new Set(this.knownSubroles());
    const metadata = new Map<string, QaSkillDescriptor>();
    for (const skill of skillList) {
      let definition: Awaited<ReturnType<Context["skills"]["get"]>>;
      try {
        definition = await registry.get(skill.name, lookup);
      } catch {
        definition = undefined;
      }
      metadata.set(
        skill.name,
        parseQaSkillMetadata(skill.name, definition?.metadata, known),
      );
    }
    return metadata;
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
