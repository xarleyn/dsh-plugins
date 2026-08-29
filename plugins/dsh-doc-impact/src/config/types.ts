export const DIRECTIONS = [
  'code-to-docs',
  'docs-to-code',
  'bidirectional',
] as const;

export const RELATIONS = [
  'documents',
  'specification',
  'synchronized',
  'related',
] as const;

export const RESOLUTION_MODES = [
  'remind',
  'require-review',
  'require-resolution',
  'require-update',
] as const;

export const SCOPES = ['turn', 'session'] as const;
export const CHANGE_DETECTION_MODES = ['auto', 'git', 'filesystem'] as const;

export type Direction = (typeof DIRECTIONS)[number];
export type Relation = (typeof RELATIONS)[number];
export type ResolutionMode = (typeof RESOLUTION_MODES)[number];
export type Scope = (typeof SCOPES)[number];
export type ChangeDetectionMode = (typeof CHANGE_DETECTION_MODES)[number];

export interface FileSelector {
  include: string[];
  exclude: string[];
}

export interface ImpactRule {
  id: string;
  description?: string;
  code: FileSelector;
  docs: FileSelector;
  direction: Direction;
  relation: Relation;
  mode: ResolutionMode;
  enabled: boolean;
}

export interface DocImpactDefaults {
  mode: ResolutionMode;
  scope: Scope;
  changeDetection: ChangeDetectionMode;
}

export interface DocImpactConfig {
  version: 1;
  defaults: DocImpactDefaults;
  rules: ImpactRule[];
}
