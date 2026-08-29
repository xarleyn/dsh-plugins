import type { Direction, Relation, ResolutionMode } from '../config/types.js';

export const IMPACT_STATUSES = [
  'pending',
  'updated',
  'reviewed-current',
  'not-applicable',
  'superseded',
] as const;

export type ImpactStatus = (typeof IMPACT_STATUSES)[number];
export type ImpactSide = 'code' | 'docs';

export interface Impact {
  id: string;
  ruleId: string;
  direction: Direction;
  triggerSide: ImpactSide;
  targetSide: ImpactSide;
  triggerFiles: string[];
  targetFiles: string[];
  relation: Relation;
  mode: ResolutionMode;
  status: ImpactStatus;
  reason?: string;
  detectedAt: number;
}

export interface ResolveImpactInput {
  ruleId: string;
  status: 'reviewed-current' | 'updated' | 'not-applicable';
  reason?: string;
}
