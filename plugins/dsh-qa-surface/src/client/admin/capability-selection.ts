import type {
  QaCapabilitySelection,
  QaSkillAccess,
  QaSubrole,
} from "../../types.js";

export type CapabilityType = "tool" | "skill";
/**
 * The three tool classes: visible immediately, reachable through a loaded
 * skill, or withdrawn from the profile whatever grants them.
 */
export type ToolBucket = "always" | "skillGrantable" | "deny";

export const TOOL_BUCKET_LABELS: Record<ToolBucket, string> = {
  always: "Всегда доступны",
  skillGrantable: "Доступны через навыки",
  deny: "Запрещённые",
};

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function bucketOf(
  selection: QaCapabilitySelection,
  bucket: ToolBucket,
): readonly string[] {
  if (bucket === "deny") return selection.tools.deny ?? [];
  return selection.tools[bucket];
}

export function emptySelection(): QaCapabilitySelection {
  return { tools: { always: [], skillGrantable: [] }, skills: [] };
}

export function emptyRole(): QaSubrole {
  return {
    id: "",
    name: "",
    description: "",
    enabled: true,
    capabilities: emptySelection(),
  };
}

/** Tools and skills one role would receive, and where each one comes from. */
export function roleEffective(
  props: {
    readonly system: QaCapabilitySelection;
    readonly common: QaCapabilitySelection;
    readonly role: QaCapabilitySelection;
    readonly skills: readonly QaSkillAccess[];
  },
  roleId: string,
) {
  // A denial beats every grant, the pinned system set included: it is the one
  // way an administrator withdraws a tool the deployment hands to everyone.
  const denied = unique([
    ...(props.common.tools.deny ?? []),
    ...(props.role.tools.deny ?? []),
  ]);
  const withheld = new Set(denied);
  const alwaysTools = unique([
    ...props.system.tools.always,
    ...props.common.tools.always,
    ...props.role.tools.always,
  ]).filter((tool) => !withheld.has(tool));
  const grantable = unique([
    ...props.common.tools.skillGrantable,
    ...props.role.tools.skillGrantable,
  ]).filter((tool) => !withheld.has(tool));
  const via = new Map<string, string[]>();
  for (const skill of props.skills) {
    const grant = skill.roles.find(({ roleId: id }) => id === roleId);
    if (grant === undefined || !grant.visible) continue;
    for (const tool of grant.grantableTools) {
      via.set(tool, [...(via.get(tool) ?? []), skill.name]);
    }
  }
  const managed = unique([
    ...props.system.skills,
    ...props.common.skills,
    ...props.role.skills,
  ]);
  const declared = props.skills
    .filter((skill) =>
      skill.roles.some(({ roleId: id, declared }) => id === roleId && declared),
    )
    .map(({ name }) => name);
  return { alwaysTools, grantable, denied, via, managed, declared };
}
