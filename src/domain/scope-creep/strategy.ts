/**
 * Scope-creep detection as a set of interchangeable strategies.
 *
 * A strategy looks at the changed symbols (and, for evidence, the blast radius)
 * and raises `Finding`s for changes that look like they drifted from the stated
 * intent. `CompositeStrategy` runs several and merges their findings. Adding or
 * swapping a heuristic — a very plausible Noon Curve Ball — touches only this
 * folder.
 */
import type { BlastRadius, ChangeSet, Finding, IntentModel, Severity, SymbolRef } from "../model.js";
import { formatLocation, symbolKey } from "../model.js";

export interface ScopeCreepInput {
  readonly changeSet: ChangeSet;
  readonly intent: IntentModel | null;
  readonly radius: BlastRadius;
}

export interface ScopeCreepStrategy {
  readonly name: string;
  evaluate(input: ScopeCreepInput): Finding[];
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export class CompositeStrategy implements ScopeCreepStrategy {
  readonly name = "composite";
  private readonly strategies: readonly ScopeCreepStrategy[];

  constructor(strategies: readonly ScopeCreepStrategy[]) {
    this.strategies = strategies;
  }

  evaluate(input: ScopeCreepInput): Finding[] {
    const merged = new Map<string, Finding>();

    for (const strategy of this.strategies) {
      for (const finding of strategy.evaluate(input)) {
        const key = symbolKey(finding.symbol);
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, { ...finding, strategy: finding.strategy });
          continue;
        }
        merged.set(key, {
          ...existing,
          severity:
            SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]
              ? finding.severity
              : existing.severity,
          strategy: `${existing.strategy}, ${finding.strategy}`,
          reason: `${existing.reason}; ${finding.reason}`,
          evidence: [...existing.evidence, ...finding.evidence],
        });
      }
    }

    return [...merged.values()].sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.dependentsCount - a.dependentsCount,
    );
  }
}

/* ------------------------------------------------------- shared helpers --- */

/** Nearest caller-path symbols for a changed symbol — the "who is affected" trail. */
export function callerTrail(
  radius: BlastRadius,
  changedQualifiedName: string,
  limit = 3,
): { path: string[]; locations: { label: string; location: string | undefined }[] } {
  const related = radius.nodes
    .filter(
      (n) =>
        n.section === "callers" &&
        n.originSymbols.includes(changedQualifiedName) &&
        !n.isTest,
    )
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);

  return {
    path: [changedQualifiedName, ...related.map((n) => n.ref.qualifiedName)],
    locations: related.map((n) => ({
      label: n.ref.qualifiedName,
      location: formatLocation(n.ref),
    })),
  };
}

export function severityForDependents(count: number): Severity {
  if (count >= 15) return "high";
  if (count >= 6) return "medium";
  return "low";
}

export function refLabel(ref: SymbolRef): string {
  const loc = formatLocation(ref);
  return loc ? `\`${ref.qualifiedName}\` (${loc})` : `\`${ref.qualifiedName}\``;
}
