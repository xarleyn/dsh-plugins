import {
  skillNameProblem,
  validateSkillDraft,
} from "../../personal-skills/skill-format.js";
import { pluralRu } from "../settings/format.js";
import type {
  QaSkillDiagnostic,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillSummary,
} from "../../types.js";

/**
 * The editor's draft: a plain, mutable-shaped snapshot of one skill, plus the
 * pure helpers the pages share.
 *
 * This module holds no serializer on purpose. The Host owns the file format;
 * the editor checks the subset of rules it can check by itself — the name
 * grammar, the required fields, the declared tools — and asks the Host for the
 * rest: the exact file, the operator's size limit, the preserved frontmatter.
 * A YAML library's Node build carries `require` calls the browser module
 * loader cannot answer, so the format's YAML half stays on the Host.
 */
export interface QaSkillDraft {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly allowedTools: readonly string[];
  readonly body: string;
}

export function emptyDraft(): QaSkillDraft {
  return {
    name: "",
    description: "",
    whenToUse: "",
    modelInvocable: true,
    userInvocable: true,
    allowedTools: [],
    body: "",
  };
}

export function draftFromDocument(document: QaSkillDocument): QaSkillDraft {
  return {
    name: document.name,
    description: document.description,
    whenToUse: document.whenToUse ?? "",
    modelInvocable: document.modelInvocable,
    userInvocable: document.userInvocable,
    allowedTools: [...document.allowedTools],
    body: document.body,
  };
}

/** Whether a fresh draft carries anything worth warning about on exit. */
export function draftHasContent(draft: QaSkillDraft): boolean {
  return (
    draft.name.trim() !== "" ||
    draft.description.trim() !== "" ||
    draft.whenToUse.trim() !== "" ||
    draft.body.trim() !== "" ||
    draft.allowedTools.length > 0
  );
}

/** Collapse diagnostics that describe the same thing for the same field. */
export function mergeDiagnostics(
  ...groups: readonly (readonly QaSkillDiagnostic[])[]
): readonly QaSkillDiagnostic[] {
  const seen = new Set<string>();
  const merged: QaSkillDiagnostic[] = [];
  for (const group of groups) {
    for (const entry of group) {
      const key = `${entry.code}:${entry.detail ?? ""}:${entry.field ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
}

export function draftIsDirty(
  draft: QaSkillDraft,
  document: QaSkillDocument,
): boolean {
  const baseline = draftFromDocument(document);
  return (
    draft.name !== baseline.name ||
    draft.description !== baseline.description ||
    draft.whenToUse !== baseline.whenToUse ||
    draft.modelInvocable !== baseline.modelInvocable ||
    draft.userInvocable !== baseline.userInvocable ||
    draft.body !== baseline.body ||
    draft.allowedTools.join(" ") !== baseline.allowedTools.join(" ")
  );
}

export interface QaSkillDraftDiagnostics {
  readonly availableTools: readonly string[];
}

/**
 * The rules the editor checks by itself, so typing is answered immediately.
 * The size limit, the preserved frontmatter and the serialized file are the
 * Host's business and arrive from it; the Host also re-checks all of this on
 * every write, so nothing here is the authority.
 */
export function draftDiagnostics(
  draft: QaSkillDraft,
  options: QaSkillDraftDiagnostics,
): readonly QaSkillDiagnostic[] {
  return validateSkillDraft({
    name: draft.name.trim(),
    description: draft.description,
    whenToUse: draft.whenToUse.trim() === "" ? null : draft.whenToUse,
    modelInvocable: draft.modelInvocable,
    userInvocable: draft.userInvocable,
    allowedTools: draft.allowedTools,
    availableTools: options.availableTools,
  });
}

/** Whether the draft is complete enough to send. */
export function draftIsSavable(draft: QaSkillDraft): boolean {
  return (
    skillNameProblem(draft.name.trim()) === null &&
    draft.description.trim() !== ""
  );
}

export function draftInput(
  draft: QaSkillDraft,
  revision: string | null,
): QaSkillDraftInput {
  const whenToUse = draft.whenToUse.trim();
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    whenToUse: whenToUse === "" ? null : whenToUse,
    modelInvocable: draft.modelInvocable,
    userInvocable: draft.userInvocable,
    allowedTools: [...draft.allowedTools],
    body: draft.body,
    expectedRevision: revision,
  };
}

/** The terse line under a catalog row: invocation, command, tool count. */
export function skillMetaLine(skill: QaSkillSummary): string {
  const parts: string[] = [skill.modelInvocable ? "Авто" : "Только вручную"];
  if (skill.userInvocable) parts.push(`/${skill.name}`);
  const tools = skill.allowedTools.length;
  parts.push(pluralRu(tools, ["инструмент", "инструмента", "инструментов"]));
  return parts.join(" · ");
}

/** Tools the catalog cannot use right now, as the row's warning text. */
export function skillToolWarning(skill: QaSkillSummary): string | null {
  const count = skill.unavailableTools.length;
  if (count === 0) return null;
  return `${pluralRu(count, [
    "инструмент недоступен",
    "инструмента недоступны",
    "инструментов недоступны",
  ])} сейчас`;
}

/** Case-insensitive search over the fields the catalog offers. */
export function skillMatchesQuery(
  skill: QaSkillSummary,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [skill.name, skill.description, skill.whenToUse ?? ""].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

/** Editing one tool name out of a draft, wherever the picker put it. */
export function withToolRemoved(
  tools: readonly string[],
  name: string,
): readonly string[] {
  return tools.filter((tool) => tool !== name);
}

export function withToolAdded(
  tools: readonly string[],
  name: string,
): readonly string[] {
  return tools.includes(name) ? tools : [...tools, name];
}
