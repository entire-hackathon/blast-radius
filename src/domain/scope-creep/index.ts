/**
 * Scope-creep detection — public surface.
 */
export type { ScopeCreepStrategy, ScopeCreepInput } from "./strategy.js";
export { CompositeStrategy } from "./strategy.js";
export { KeywordOverlapStrategy } from "./keyword-overlap.js";
export { DependentsThresholdStrategy } from "./dependents.js";

import { DependentsThresholdStrategy } from "./dependents.js";
import { KeywordOverlapStrategy } from "./keyword-overlap.js";
import { CompositeStrategy, type ScopeCreepStrategy } from "./strategy.js";

export interface ScopeCreepConfig {
  readonly keywordMaxOverlap?: number;
  readonly keywordMinDependents?: number;
  readonly dependentsThreshold?: number;
}

/** The default detector: keyword-overlap + wide-reaching-change, merged. */
export function defaultScopeCreepStrategy(cfg: ScopeCreepConfig = {}): ScopeCreepStrategy {
  return new CompositeStrategy([
    new KeywordOverlapStrategy({
      ...(cfg.keywordMaxOverlap !== undefined ? { maxOverlap: cfg.keywordMaxOverlap } : {}),
      ...(cfg.keywordMinDependents !== undefined
        ? { minDependents: cfg.keywordMinDependents }
        : {}),
    }),
    new DependentsThresholdStrategy(
      cfg.dependentsThreshold !== undefined ? { threshold: cfg.dependentsThreshold } : {},
    ),
  ]);
}
