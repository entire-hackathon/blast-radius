/**
 * The `review` use-case — the pipeline spelled out.
 *
 *   diff ─▶ impact per changed symbol ─▶ blast radius
 *                                          │
 *                     ┌────────────────────┼─────────────────────┐
 *                     ▼                    ▼                     ▼
 *              scope-creep check     test selection        radius summary
 *                     └────────────────────┼─────────────────────┘
 *                                          ▼
 *                                   AnalysisReport ─▶ render ─▶ publish
 *
 * Depends only on ports. The composition root supplies the implementations.
 */
import { computeBlastRadius } from "../domain/blast-radius.js";
import { BlastRadiusError, err, isErr, ok, type Result, settle } from "../domain/errors.js";
import type { AnalysisReport, RadiusNode } from "../domain/model.js";
import { reportBuilder } from "../domain/report.js";
import type { ScopeCreepStrategy } from "../domain/scope-creep/index.js";
import { summarizeRadius, type SummaryOptions } from "../domain/summary.js";
import { selectTests, type TestSelectionOptions } from "../domain/test-selection.js";
import type { CommitRange, GraphProvider } from "../ports/graph-provider.js";
import { impactQueryFor } from "../ports/graph-provider.js";
import type { IntentSource, PrContext } from "../ports/intent-source.js";
import type { ReportSink } from "../ports/report-sink.js";
import type { Renderer } from "../ports/renderer.js";

export type LogLevel = "info" | "warn" | "error";

export interface ReviewDeps {
  readonly graph: GraphProvider;
  readonly intent: IntentSource;
  readonly scopeCreep: ScopeCreepStrategy;
  /** one renderer + sink per configured output. */
  readonly outputs: readonly { renderer: Renderer; sink: ReportSink }[];
  readonly log: (level: LogLevel, message: string) => void;
  readonly clock?: () => Date;
}

export interface ReviewRequest {
  readonly range: CommitRange;
  readonly prContext: PrContext;
  readonly testSelection?: TestSelectionOptions;
  readonly summary?: SummaryOptions;
}

export interface ReviewOutcome {
  readonly report: AnalysisReport;
  readonly publishedTo: string[];
  /** sinks that failed — a non-fatal partial result unless every sink failed. */
  readonly sinkErrors: { sink: string; message: string }[];
  readonly hasFindings: boolean;
}

export async function runReview(
  deps: ReviewDeps,
  req: ReviewRequest,
): Promise<Result<ReviewOutcome>> {
  const { graph, intent, scopeCreep, log } = deps;

  /* 1 — changed symbols ------------------------------------------------ */
  const diffRes = await graph.diff(req.range);
  if (isErr(diffRes)) return diffRes;
  const changeSet = diffRes.value;
  log(
    "info",
    `${changeSet.symbols.length} changed symbol(s) across ${changeSet.changedFiles.length} file(s)`,
  );

  /* 2 — impact per symbol -------------------------------------------- */
  const impactResults = await Promise.all(
    changeSet.symbols.map((s) => graph.impact(impactQueryFor(s.ref))),
  );
  const { values: impacts, errors: impactErrors } = settle<
    { nodes: readonly RadiusNode[]; disambiguationRequired: boolean },
    BlastRadiusError
  >(impactResults);
  for (const e of impactErrors) log("warn", `impact skipped: ${e.message}`);

  const nodeLists = impacts.map((i) => i.nodes);

  /* 3 — blast radius ------------------------------------------------- */
  const radius = computeBlastRadius(changeSet.symbols, nodeLists);
  log("info", `blast radius: ${radius.nodes.length} node(s)`);

  /* 4 — intent ----------------------------------------------------- */
  const intentRes = await intent.get(req.prContext);
  const intentModel = isErr(intentRes) ? null : intentRes.value;
  if (isErr(intentRes)) log("warn", `intent unavailable: ${intentRes.error.message}`);
  else log("info", intentModel ? `intent from ${intentModel.source}` : "no stated intent found");

  /* 5 — fan out: scope / tests / summary --------------------------- */
  const findings = scopeCreep.evaluate({ changeSet, intent: intentModel, radius });
  const testPlan = selectTests(radius, changeSet.symbols, req.testSelection);
  const summary = summarizeRadius(radius, req.summary);

  /* 6 — report --------------------------------------------------- */
  const report = reportBuilder.build({
    range: { base: req.range.base, head: req.range.head, checkpoint: changeSet.checkpoint },
    changeSet,
    intent: intentModel,
    radius,
    summary,
    findings,
    testPlan,
    ...(deps.clock ? { now: deps.clock() } : {}),
  });

  /* 7 — render + publish -------------------------------------- */
  const publishedTo: string[] = [];
  const sinkErrors: { sink: string; message: string }[] = [];
  for (const { renderer, sink } of deps.outputs) {
    const rendered = renderer.render(report);
    const res = await sink.publish(rendered);
    if (isErr(res)) {
      log("error", `publish to ${sink.kind} failed: ${res.error.message}`);
      sinkErrors.push({ sink: sink.kind, message: res.error.message });
      continue;
    }
    publishedTo.push(`${renderer.format}→${sink.kind}`);
  }
  // only fatal if nothing at all got out
  if (publishedTo.length === 0 && sinkErrors.length > 0) {
    return err(BlastRadiusError.sink(sinkErrors.map((e) => `${e.sink}: ${e.message}`).join("; ")));
  }

  return ok({ report, publishedTo, sinkErrors, hasFindings: findings.length > 0 });
}
