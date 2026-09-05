/**
 * Assemble the immutable `AnalysisReport` from the stage outputs.
 *
 * This is the one object every renderer consumes and the JSON output emits, so
 * it is validated against `analysisReportSchema` before it leaves the builder —
 * a renderer never has to defend against a malformed report.
 */
import type {
  AnalysisReport,
  BlastRadius,
  ChangeSet,
  Finding,
  IntentModel,
  RadiusSummary,
  SymbolRef,
  TestPlan,
} from "./model.js";
import { analysisReportSchema, SCHEMA_VERSION } from "./model.js";

export interface BuildReportInput {
  readonly range: { base: string; head: string; checkpoint?: string | undefined };
  readonly changeSet: ChangeSet;
  readonly intent: IntentModel | null;
  readonly radius: BlastRadius;
  readonly summary: RadiusSummary;
  readonly findings: readonly Finding[];
  readonly testPlan: TestPlan;
  readonly now?: Date;
}

function plainRef(ref: SymbolRef) {
  return {
    name: ref.name,
    qualifiedName: ref.qualifiedName,
    ...(ref.kind !== undefined ? { kind: ref.kind } : {}),
    ...(ref.file !== undefined ? { file: ref.file } : {}),
    ...(ref.line !== undefined ? { line: ref.line } : {}),
    ...(ref.language !== undefined ? { language: ref.language } : {}),
    external: ref.external,
  };
}

export class AnalysisReportBuilder {
  build(input: BuildReportInput): AnalysisReport {
    const widestDependents = input.changeSet.symbols.reduce(
      (max, s) => Math.max(max, s.dependentsCount),
      0,
    );

    const findingNames = new Set(input.findings.map((f) => f.symbol.qualifiedName));

    const report: AnalysisReport = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: (input.now ?? new Date()).toISOString(),
      range: {
        base: input.range.base,
        head: input.range.head,
        ...(input.range.checkpoint !== undefined ? { checkpoint: input.range.checkpoint } : {}),
      },
      intent: input.intent,
      changeSummary: {
        symbolCount: input.changeSet.symbols.length,
        fileCount: input.changeSet.changedFiles.length,
        widestDependents,
      },
      changedSymbols: input.changeSet.symbols.map((s) => ({
        ref: plainRef(s.ref),
        changeType: s.changeType,
        dependentsCount: s.dependentsCount,
        isFinding: findingNames.has(s.ref.qualifiedName),
      })),
      radiusNodes: input.radius.nodes.map((n) => ({
        ref: plainRef(n.ref),
        section: n.section,
        relation: n.relation,
        direction: n.direction,
        distance: n.distance,
        via: [...n.viaChain],
        origins: [...n.originSymbols],
        isTest: n.isTest,
      })),
      originEdges: input.radius.originEdges.map((e) => ({ from: e.from, to: e.to })),
      radiusSummary: {
        totalNodes: input.summary.totalNodes,
        fileCount: input.summary.fileCount,
        moduleCount: input.summary.moduleCount,
        serviceCount: input.summary.serviceCount,
        testCount: input.summary.testCount,
        byRelation: input.summary.byRelation,
      },
      findings: input.findings.map((f) => ({
        symbol: plainRef(f.symbol),
        severity: f.severity,
        strategy: f.strategy,
        reason: f.reason,
        dependentsCount: f.dependentsCount,
        evidence: f.evidence.map((e) => ({
          label: e.label,
          ...(e.location !== undefined ? { location: e.location } : {}),
          relationPath: [...e.relationPath],
        })),
      })),
      testPlan: {
        framework: input.testPlan.framework,
        selected: input.testPlan.selected.map((t) => ({
          ref: plainRef(t.ref),
          score: t.score,
          distance: t.distance,
          coversSymbols: [...t.coversSymbols],
          framework: t.framework,
        })),
        command: input.testPlan.command,
        coverageGaps: [...input.testPlan.coverageGaps],
      },
    };

    // fail loud if we ever build something off-contract
    return analysisReportSchema.parse(report);
  }
}

export const reportBuilder = new AnalysisReportBuilder();
