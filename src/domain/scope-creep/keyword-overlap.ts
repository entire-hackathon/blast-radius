/**
 * "This changed symbol shares no vocabulary with the stated intent, and other
 * code depends on it." — the core scope-creep signal.
 *
 * Needs an intent; with none it stays silent (you cannot judge drift from an
 * ask you do not have).
 */
import { keywordOverlap } from "../intent-keywords.js";
import type { Finding } from "../model.js";
import { formatLocation } from "../model.js";
import {
  callerTrail,
  type ScopeCreepInput,
  type ScopeCreepStrategy,
  severityForDependents,
} from "./strategy.js";

export interface KeywordOverlapOptions {
  /** below this overlap fraction the symbol looks unrelated to the intent. */
  readonly maxOverlap?: number;
  /** and it only matters if at least this many things depend on it. */
  readonly minDependents?: number;
}

export class KeywordOverlapStrategy implements ScopeCreepStrategy {
  readonly name = "keyword-overlap";
  private readonly maxOverlap: number;
  private readonly minDependents: number;

  constructor(opts: KeywordOverlapOptions = {}) {
    this.maxOverlap = opts.maxOverlap ?? 0.15;
    this.minDependents = opts.minDependents ?? 3;
  }

  evaluate(input: ScopeCreepInput): Finding[] {
    const { intent, changeSet, radius } = input;
    if (!intent || intent.keywords.length === 0) return [];

    const findings: Finding[] = [];

    for (const changed of changeSet.symbols) {
      if (changed.changeType === "added") continue; // new code can't "drift"
      if (changed.dependentsCount < this.minDependents) continue;

      const { overlap, shared, symbolTokenCount } = keywordOverlap(
        changed.ref.qualifiedName,
        changed.ref.file,
        intent.keywords,
      );
      if (symbolTokenCount === 0 || overlap > this.maxOverlap) continue;

      const trail = callerTrail(radius, changed.ref.qualifiedName);
      findings.push({
        symbol: changed.ref,
        severity: severityForDependents(changed.dependentsCount),
        strategy: this.name,
        reason:
          shared.length === 0
            ? `no vocabulary overlap with the stated intent`
            : `weak overlap with the stated intent (only: ${shared.join(", ")})`,
        dependentsCount: changed.dependentsCount,
        evidence: [
          {
            label: `intent (${intent.source}): "${intent.title || intent.body.slice(0, 80)}"`,
            location: undefined,
            relationPath: [],
          },
          {
            label: `changed here — ${changed.changeType.replace("_", " ")}, ${changed.dependentsCount} dependents`,
            location: formatLocation(changed.ref),
            relationPath: [],
          },
          ...(trail.locations.length > 0
            ? [
                {
                  label: `reaches ${trail.locations.map((l) => l.label).join(" → ")}`,
                  location: trail.locations[0]?.location,
                  relationPath: trail.path,
                },
              ]
            : []),
        ],
      });
    }

    return findings;
  }
}
