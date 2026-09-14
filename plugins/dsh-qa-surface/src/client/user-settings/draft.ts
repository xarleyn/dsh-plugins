import {
  QA_SKILL_FILE_MAX_BYTES,
  serializeSkillFile,
  skillFileBytes,
  skillNameProblem,
  validateSkillDraft,
  type QaSkillFileDraft,
} from "../../personal-skills/skill-file.js";
import { pluralRu } from "../settings/format.js";
import type {
  QaSkillDiagnostic,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillJsonValue,
  QaSkillSummary,
} from "../../types.js";

/**
 * The editor's draft: a plain, mutable-shaped snapshot of one skill, plus
 * every pure helper the pages share. Nothing here talks to the Host, so the
 * same projection feeds the live preview, the local validation and the save
 * payload — the editor cannot show one thing and write another.
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

function toFileDraft(
  draft: QaSkillDraft,
  extraFrontmatter: Readonly<Record<string, QaSkillJsonValue>>,
): QaSkillFileDraft {
  const whenToUse = draft.whenToUse.trim();
  return {
    name: draft.name.trim(),
    description: draft.description,
    whenToUse: whenToUse === "" ? null : whenToUse,
    modelInvocable: draft.modelInvocable,
    userInvocable: draft.userInvocable,
    allowedTools: draft.allowedTools,
    extraFrontmatter,
    body: draft.body,
  };
}

/** The exact file a Save would write, built by the serializer the Host uses. */
export function draftPreview(
  draft: QaSkillDraft,
  extraFrontmatter: Readonly<Record<string, QaSkillJsonValue>>,
): string {
  return serializeSkillFile(toFileDraft(draft, extraFrontmatter));
}

export interface QaSkillDraftDiagnostics {
  readonly availableTools: readonly string[];
  readonly maxBytes?: number;
}

/**
 * Validate the draft the way the Host will, so the editor's messages appear
 * while typing instead of after a round trip. The Host stays the authority.
 */
export function draftDiagnostics(
  draft: QaSkillDraft,
  extraFrontmatter: Readonly<Record<string, QaSkillJsonValue>>,
  options: QaSkillDraftDiagnostics,
): readonly QaSkillDiagnostic[] {
  const text = draftPreview(draft, extraFrontmatter);
  return validateSkillDraft({
    name: draft.name.trim(),
    description: draft.description,
    whenToUse: draft.whenToUse.trim() === "" ? null : draft.whenToUse,
    modelInvocable: draft.modelInvocable,
    userInvocable: draft.userInvocable,
    allowedTools: draft.allowedTools,
    sizeBytes: skillFileBytes(text),
    maxBytes: options.maxBytes ?? QA_SKILL_FILE_MAX_BYTES,
    availableTools: options.availableTools,
    extraFieldNames: Object.keys(extraFrontmatter),
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
