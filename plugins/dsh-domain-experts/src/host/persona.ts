import {
  EXPERT_RESULT_MARKER,
  MAX_TASK_LENGTH,
  type DomainDefinition,
  type DomainExpertRequest,
  type MemoryRecord,
  type ResolvedDelegationSummary,
  type ResolvedMemoryEntry,
  type ResolvedResourceEntry,
} from "../types.js";
import { DomainExpertsError } from "./errors.js";

/**
 * The built-in expert policy. Users append custom instructions; they never
 * have to restate this, and they cannot replace it (design §9, §31).
 *
 * The text deliberately contains no `{{`: the composed persona is handed to
 * the subagent runtime as a persona template, and a brace sequence would be
 * interpolated against deployment variables.
 */
export const BASE_POLICY = [
  "You are the designated expert for one domain of a larger product.",
  "",
  "Reason from this domain's point of view and prefer evidence from resources that belong to it.",
  "Do not infer the internal behaviour of another domain when the answer depends on it: ask that domain's expert instead of guessing.",
  "Never read another domain's private memory or resources directly.",
  "",
  "Classify every claim by how you know it, and keep the classes apart:",
  "- documented: stated by a specification, README or design note;",
  "- implemented: visible in the source you read;",
  "- remembered: recalled from this domain's memory notes;",
  "- inferred: your own reasoning that goes beyond the evidence.",
  "",
  "When two sources disagree, report the conflict instead of merging them.",
  "Never present an inference as an implementation detail.",
  "Name the file path, document or memory key behind each finding.",
  "When you cannot find evidence, say so plainly rather than filling the gap.",
].join("\n");

export interface PersonaInput {
  readonly definition: DomainDefinition;
  readonly resources: readonly ResolvedResourceEntry[];
  readonly memory: readonly ResolvedMemoryEntry[];
  readonly memorySnippets: readonly MemoryRecord[];
  readonly delegation: ResolvedDelegationSummary;
  readonly request: DomainExpertRequest;
  readonly callerDomain: string | null;
  readonly depth: number;
}

/** Compose the child persona: base policy + domain + scope + memory + task. */
export function composePersona(input: PersonaInput): string {
  const { definition } = input;
  const sections: string[] = [
    BASE_POLICY,
    "",
    `You are the expert for the "${definition.name}" domain (id: ${definition.id}).`,
  ];

  if (definition.description !== "") {
    sections.push("", "## Domain", definition.description);
  }

  const scope = scopeSection(input);
  if (scope !== "") sections.push("", "## Scope", scope);

  const memory = memorySection(input.memory, input.memorySnippets);
  if (memory !== "") sections.push("", "## Remembered context", memory);

  sections.push("", "## Delegation", delegationSection(input));

  const instructions = definition.persona.instructions.trim();
  if (instructions !== "") {
    sections.push("", "## Domain-specific instructions", instructions);
  }

  sections.push("", "## Task", taskSection(input));
  sections.push("", "## Answer format", ANSWER_FORMAT);

  const persona = sections.join("\n");
  if (persona.includes("{{")) {
    // A guard, not a second validation: the record schema already refuses
    // `{{` in user instructions, so reaching here means a plugin defect.
    throw new DomainExpertsError(
      "DOMAIN_INVALID",
      "Composed persona contains a template sequence; refusing to start a child with it.",
    );
  }
  return persona;
}

function scopeSection(input: PersonaInput): string {
  const lines: string[] = [];
  const byClass = (resourceClass: ResolvedResourceEntry["class"]): string[] =>
    input.resources
      .filter((entry) => entry.class === resourceClass)
      .map(
        (entry) =>
          `${entry.path}${entry.enforcement === "enforced" ? "" : " (preference only)"}`,
      );

  const primary = byClass("primary");
  if (primary.length > 0) {
    lines.push("Owned by this domain:", ...primary.map((path) => `- ${path}`));
  }
  const shared = byClass("shared");
  if (shared.length > 0) {
    lines.push(
      "",
      "Shared, read-only, owned by another domain:",
      ...shared.map((path) => `- ${path}`),
    );
  }
  const denied = byClass("denied");
  if (denied.length > 0) {
    lines.push(
      "",
      "Outside this domain — do not use:",
      ...denied.map((path) => `- ${path}`),
    );
  }
  const knowledge = input.definition.scope.documentation;
  if (knowledge.include.length > 0) {
    lines.push(
      "",
      "Knowledge sources to prefer:",
      ...knowledge.include.map((p) => `- ${p}`),
    );
  }
  if (knowledge.exclude.length > 0) {
    lines.push(
      "",
      "Knowledge sources to avoid:",
      ...knowledge.exclude.map((p) => `- ${p}`),
    );
  }
  if (lines.length === 0) {
    // The section is always present: an expert with no configured scope should
    // be told that, rather than left to assume it owns everything.
    lines.push(
      "No filesystem or knowledge scope is configured for this domain. Work from the task, your tools and your own evidence.",
    );
  }
  return lines.join("\n");
}

function memorySection(
  entries: readonly ResolvedMemoryEntry[],
  snippets: readonly MemoryRecord[],
): string {
  const lines: string[] = [];
  if (entries.length > 0) {
    lines.push("Your memory namespaces:");
    for (const entry of entries) {
      const access = entry.access === "read-write" ? "read/write" : "read-only";
      lines.push(`- ${entry.namespace} (${access})`);
    }
  }
  if (snippets.length > 0) {
    lines.push("", "Notes recorded earlier, most relevant first:");
    for (const record of snippets) {
      lines.push(`- [${record.namespace}/${record.key}] ${record.text}`);
    }
  }
  return lines.join("\n");
}

function delegationSection(input: PersonaInput): string {
  const { delegation, definition, callerDomain, depth } = input;
  const lines: string[] = [
    `Delegation depth: ${String(depth)} of at most ${String(delegation.maxDepth)}.`,
  ];
  if (callerDomain !== null) {
    lines.push(
      `You were asked by the "${callerDomain}" expert; answer within your own domain.`,
    );
  }
  if (!delegation.allowCrossDomain || delegation.mode === "disabled") {
    lines.push(
      "Cross-domain access is disabled for you. If the task depends on another domain, report that dependency instead of answering for it.",
    );
    return lines.join("\n");
  }
  const targets =
    delegation.targets.length > 0
      ? delegation.targets.join(", ")
      : "any other domain";
  lines.push(
    `Cross-domain mode: ${delegation.mode}. You may ask another domain's expert with the domain_delegate tool (targets: ${targets}).`,
  );
  if (delegation.mode === "expert-only") {
    lines.push(
      "Ask the owning expert for anything from another domain; do not read its memory or resources yourself.",
    );
  } else {
    lines.push(
      "You may also read the foreign memory namespaces explicitly configured for you.",
    );
  }
  if (delegation.targets.includes(definition.id)) {
    lines.push(
      "You are listed as a target of your own delegation; ignore that entry.",
    );
  }
  return lines.join("\n");
}

function taskSection(input: PersonaInput): string {
  const { request } = input;
  const task = clamp(request.task);
  const lines: string[] = [];
  switch (request.mode) {
    case "investigate":
      lines.push(
        "Investigate the following and report the root cause with evidence.",
      );
      break;
    case "review":
      lines.push(
        "Review the following and report deviations, risks and open questions.",
      );
      break;
    case "answer":
      lines.push("Answer the following question with evidence.");
      break;
  }
  lines.push("", task);
  if (request.context.trim() !== "") {
    lines.push("", "Context supplied by the caller:", clamp(request.context));
  }
  if (request.output.trim() !== "") {
    lines.push("", "The caller needs:", clamp(request.output));
  }
  return lines.join("\n");
}

function clamp(value: string): string {
  return value.length > MAX_TASK_LENGTH
    ? `${value.slice(0, MAX_TASK_LENGTH)}…`
    : value;
}

/**
 * Structured-answer contract. The marker fence is what the parser looks for
 * first, so a child that also narrates its reasoning still yields findings.
 */
export const ANSWER_FORMAT = [
  "Finish with one fenced code block tagged `" +
    EXPERT_RESULT_MARKER +
    "` containing JSON:",
  "",
  "```" + EXPERT_RESULT_MARKER,
  '{ "summary": "one paragraph",',
  '  "findings": [ { "claim": "...", "evidence": ["path:line", "document"], "confidence": "high" } ],',
  '  "conflicts": ["source A says X, source B says Y"],',
  '  "assumptions": ["..."],',
  '  "followUps": ["..."] }',
  "```",
  "",
  "Use `high`, `medium` or `low` for confidence. Omit a list rather than inventing entries; an empty array is a valid answer.",
].join("\n");

/** Opening fence the structured parser matches. */
export function resultFenceOpen(): string {
  return "```" + EXPERT_RESULT_MARKER;
}
