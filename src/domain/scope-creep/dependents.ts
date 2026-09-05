/**
 * "This change is wide-reaching." — a lot of code depends on a symbol that was
 * modified, whether or not there is a stated intent. On its own it is not proof
 * of scope creep, but it is always worth the reviewer's eyes, and combined with
 * a keyword-overlap miss it is a strong signal.
 */
import type { Finding } from "../model.js";
import { formatLocation } from "../model.js";
import {
  callerTrail,
  type ScopeCreepInput,
  type ScopeCreepStrategy,
  severityForDependents,
} from "./strategy.js";

export interface DependentsThresholdOptions {
  /** dependents at or above this make the change "wide-reaching". */
  readonly threshold?: number;
}

export class DependentsThresholdStrategy implements ScopeCreepStrategy {
  readonly name = "dependents-threshold";
  private readonly threshold: number;

  constructor(opts: DependentsThresholdOptions = {}) {
    this.threshold = opts.threshold ?? 8;
  }

  evaluate(input: ScopeCreepInput): Finding[] {
    const findings: Finding[] = [];

    for (const changed of input.changeSet.symbols) {
      if (changed.dependentsCount < this.threshold) continue;
      if (changed.changeType === "added") continue;

      const trail = callerTrail(input.radius, changed.ref.qualifiedName);
      const signatureChange =
        changed.changeType === "signature_changed" || changed.changeType === "renamed";

      findings.push({
        symbol: changed.ref,
        severity: severityForDependents(changed.dependentsCount),
        strategy: this.name,
        reason: signatureChange
          ? `${changed.changeType.replace("_", " ")} on a symbol with ${changed.dependentsCount} dependents — run tests first`
          : `wide-reaching change: ${changed.dependentsCount} dependents`,
        dependentsCount: changed.dependentsCount,
        evidence: [
          {
            label: `${changed.changeType.replace("_", " ")}${
              changed.oldSignature && changed.newSignature
                ? `: \`${changed.oldSignature}\` → \`${changed.newSignature}\``
                : ""
            }`,
            location: formatLocation(changed.ref),
            relationPath: [],
          },
          ...(trail.locations.length > 0
            ? [
                {
                  label: `dependents include ${trail.locations.map((l) => l.label).join(", ")}`,
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
