import type { Impact } from '../impact/types.js';
import type { FileChange } from '../changes/types.js';
import type { ImpactRule } from '../config/types.js';

const MAX_LISTED_FILES = 8;

export type Attribution = 'own' | 'uncertain';

function listFiles(files: readonly string[], indent: string): string {
  const shown = files.slice(0, MAX_LISTED_FILES);
  const lines = shown.map((file) => `${indent}- ${file}`);
  const hidden = files.length - shown.length;
  if (hidden > 0) lines.push(`${indent}- … and ${hidden} more`);
  return lines.join('\n');
}

function relationLabel(impact: Impact): string {
  const source = impact.triggerSide === 'code' ? 'implementation' : 'documentation';
  const target = impact.targetSide === 'docs' ? 'documentation' : 'implementation';
  return `${impact.ruleId}: ${source} → ${target} (${impact.relation})`;
}

function missingTargets(impact: Impact, knownFiles: ReadonlySet<string>): string[] {
  return impact.targetFiles.filter((file) => !knownFiles.has(file));
}

function impactBlock(impact: Impact, index: number, knownFiles: ReadonlySet<string>): string {
  const lines: string[] = [];
  const strict = impact.mode !== 'remind';
  lines.push(`${index}. ${impact.ruleId}${strict ? ` [${impact.mode}]` : ''}`);
  lines.push(`   relation: ${relationLabel(impact)}`);
  if (impact.triggerFiles.length > 0) {
    lines.push('   changed:');
    lines.push(listFiles(impact.triggerFiles, '   '));
  }
  if (impact.targetFiles.length > 0) {
    lines.push('   review:');
    lines.push(listFiles(impact.targetFiles, '   '));
  }
  const missing = missingTargets(impact, knownFiles);
  for (const file of missing) {
    lines.push(`   ! expected documentation target does not exist: ${file}`);
  }
  return lines.join('\n');
}

const REMIND_TAIL = 'Update the documents if behavior changed.';

const STRICT_TAIL = [
  'Update each document if behavior changed.',
  'If a document is already current after your review, resolve the impact explicitly:',
  '  doc_impact_resolve { "ruleId": "<rule id>", "status": "reviewed-current" }',
  'Use status "not-applicable" with a non-empty reason when the link does not apply to this change.',
].join('\n');

/** The single grouped steering message (SPEC §32-§33). */
export function buildReminderMessage(
  impacts: readonly Impact[],
  knownFiles: ReadonlySet<string>,
  attribution: Attribution = 'own',
): string {
  const header = 'Documentation impact check';
  const intro =
    attribution === 'uncertain'
      ? 'Files changed while this agent was active, and project rules link them to documentation.'
      : 'Your changes affect documentation linked by project rules.';

  const blocks = impacts.map((impact, index) => impactBlock(impact, index + 1, knownFiles));
  const count = `${impacts.length} rule${impacts.length === 1 ? ' was' : 's were'} triggered.`;
  const body = blocks.join('\n\n');
  const tail = impacts.length === 1 && impacts[0]?.mode === 'remind' ? REMIND_TAIL : STRICT_TAIL;

  return [header, '', intro, '', count, '', body, '', tail].join('\n');
}

/** Final fail-open notice when `maxReminderRounds` is exhausted (SPEC §34, §36). */
export function buildLimitMessage(impacts: readonly Impact[], rounds: number): string {
  const ids = impacts.map((impact) => `- ${impact.ruleId} → ${impact.targetFiles.join(', ') || '(no targets)'}`);
  return [
    'Documentation impact check: reminder limit reached',
    '',
    `The following impacts stayed unresolved after ${rounds} reminder round(s); allowing the turn to finish:`,
    ...ids,
    '',
    'Please review the linked documentation as soon as possible.',
  ].join('\n');
}

/** `/doc-impact` status summary (SPEC §41). */
export function formatStatus(pending: readonly Impact[], resolved: readonly Impact[]): string {
  if (pending.length === 0 && resolved.length === 0) {
    return 'Documentation impacts: none.';
  }
  const lines = [`Documentation impacts — pending: ${pending.length}, resolved: ${resolved.length}`];
  for (const impact of pending) {
    lines.push(`  pending  ${impact.ruleId} → ${impact.targetFiles.join(', ')}`);
  }
  for (const impact of resolved) {
    lines.push(`  ${impact.status.padEnd(16)} ${impact.ruleId} → ${impact.targetFiles.join(', ')}`);
  }
  return lines.join('\n');
}

/** `/doc-impact changed` summary (SPEC §41). */
export function formatChanged(changes: readonly FileChange[]): string {
  if (changes.length === 0) {
    return 'The plugin attributes no changed files to this agent.';
  }
  const lines = [`${changes.length} file(s) changed since the turn baseline:`];
  for (const change of changes.slice(0, 40)) {
    lines.push(`  ${change.type.padEnd(9)} ${change.path}`);
  }
  if (changes.length > 40) lines.push(`  … and ${changes.length - 40} more`);
  return lines.join('\n');
}

/** `/doc-impact explain <rule>` (SPEC §90). */
export function formatExplain(rule: ImpactRule, impacted: boolean): string {
  const lines = [
    `Rule: ${rule.id}`,
    rule.description === undefined ? undefined : `Description: ${rule.description}`,
    `Code: ${rule.code.include.join(', ')}${rule.code.exclude.length > 0 ? ` (excluding ${rule.code.exclude.join(', ')})` : ''}`,
    `Documentation: ${rule.docs.include.join(', ')}${rule.docs.exclude.length > 0 ? ` (excluding ${rule.docs.exclude.join(', ')})` : ''}`,
    `Direction: ${rule.direction}`,
    `Relation: ${rule.relation}`,
    `Mode: ${rule.mode}`,
    `Enabled: ${String(rule.enabled)}`,
    impacted ? 'This rule is currently triggered by this agent\'s changes.' : 'This rule is not currently triggered.',
  ];
  return lines.filter((line) => line !== undefined).join('\n');
}
