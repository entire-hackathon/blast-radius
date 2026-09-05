/**
 * Scope findings as SARIF 2.1.0 — so they land in the GitHub "Code scanning"
 * tab and any SARIF-aware tool. This also makes the check a first-class CI
 * signal and is a ready hedge if the constraint turns out to be "produce a
 * machine-verifiable artifact".
 */
import type { AnalysisReport, Severity } from "../../domain/model.js";
import type { Renderer, RenderedReport } from "../../ports/renderer.js";

const SARIF_LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  high: "error",
  medium: "warning",
  low: "note",
};

export class SarifRenderer implements Renderer {
  readonly format = "sarif" as const;

  render(report: AnalysisReport): RenderedReport {
    const rules = new Map<string, unknown>();
    const results = report.findings.map((f) => {
      const ruleId = `blast-radius/scope/${f.strategy.split(",")[0]?.trim() ?? "scope"}`;
      if (!rules.has(ruleId)) {
        rules.set(ruleId, {
          id: ruleId,
          name: "ScopeDrift",
          shortDescription: { text: "Change outside the stated intent" },
          helpUri: "https://github.com/entire-hackathon/blast-radius#scope-check",
          defaultConfiguration: { level: SARIF_LEVEL[f.severity] },
        });
      }
      return {
        ruleId,
        level: SARIF_LEVEL[f.severity],
        message: {
          text: `${f.symbol.qualifiedName}: ${f.reason} (${f.dependentsCount} dependents). ${f.evidence
            .map((e) => e.label)
            .join(" | ")}`,
        },
        locations: f.symbol.file
          ? [
              {
                physicalLocation: {
                  artifactLocation: { uri: f.symbol.file },
                  region: { startLine: Math.max(1, f.symbol.line ?? 1) },
                },
              },
            ]
          : [],
        properties: {
          dependents: f.dependentsCount,
          strategy: f.strategy,
          relationPath: f.evidence.flatMap((e) => e.relationPath),
        },
      };
    });

    const sarif = {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "Blast Radius",
              informationUri: "https://github.com/entire-hackathon/blast-radius",
              version: report.schemaVersion,
              rules: [...rules.values()],
            },
          },
          results,
          properties: {
            radiusNodes: report.radiusSummary.totalNodes,
            recommendedTests: report.testPlan.selected.map((t) => t.ref.name),
            coverageGaps: report.testPlan.coverageGaps,
          },
        },
      ],
    };

    return {
      format: "sarif",
      contentType: "application/sarif+json",
      body: JSON.stringify(sarif, null, 2),
      marker: undefined,
    };
  }
}
