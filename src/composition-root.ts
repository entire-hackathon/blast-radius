/**
 * Composition root — the ONLY file that imports `adapters/`.
 *
 * Turns a resolved `ReviewConfig` into wired `ReviewDeps` + `ReviewRequest`.
 * Swapping an implementation (fixture vs real graph, stdout vs PR comment) is a
 * choice made here from config, nowhere else.
 */
import { EntireGraphCliAdapter } from "./adapters/graph/entire-graph-cli.js";
import { FixtureGraphAdapter } from "./adapters/graph/fixture.js";
import { CheckpointTrailerIntentSource } from "./adapters/intent/checkpoint-trailer.js";
import { CompositeIntentSource } from "./adapters/intent/composite.js";
import { GitHubIssueIntentSource } from "./adapters/intent/github-issue.js";
import { PrBodyIntentSource } from "./adapters/intent/pr-body.js";
import { JsonRenderer } from "./adapters/render/json.js";
import { MarkdownRenderer } from "./adapters/render/markdown.js";
import { SarifRenderer } from "./adapters/render/sarif.js";
import { FileSink } from "./adapters/sink/file.js";
import { GitHubCommentSink } from "./adapters/sink/github-comment.js";
import { StdoutSink } from "./adapters/sink/stdout.js";
import type { ReviewConfig } from "./app/config.js";
import type { LogLevel, ReviewDeps, ReviewRequest } from "./app/review.js";
import { BlastRadiusError } from "./domain/errors.js";
import { defaultScopeCreepStrategy } from "./domain/scope-creep/index.js";
import type { GraphProvider } from "./ports/graph-provider.js";
import type { IntentSource } from "./ports/intent-source.js";
import type { ReportSink } from "./ports/report-sink.js";
import type { Renderer } from "./ports/renderer.js";

export type Logger = (level: LogLevel, message: string) => void;

export interface WiredReview {
  readonly deps: ReviewDeps;
  readonly request: ReviewRequest;
}

export function composeReview(config: ReviewConfig, log: Logger = () => {}): WiredReview {
  const graph = buildGraph(config);
  const intent = buildIntent(config, log);
  const outputs = buildOutputs(config);

  const deps: ReviewDeps = {
    graph,
    intent,
    scopeCreep: defaultScopeCreepStrategy(config.scopeCreep),
    outputs,
    log,
  };

  const request: ReviewRequest = {
    range: config.range,
    prContext: {
      repoPath: config.repoPath,
      base: config.range.base,
      head: config.range.head,
      prNumber: config.pr.number,
      prTitle: config.pr.title,
      prBody: config.pr.body,
      repoSlug: config.pr.repoSlug,
    },
    testSelection: { maxTests: config.testSelection.maxTests },
    summary: { moduleDepth: config.summary.moduleDepth },
  };

  return { deps, request };
}

/* ------------------------------------------------------------- builders --- */

function buildGraph(config: ReviewConfig): GraphProvider {
  if (config.graph.mode === "fixture") {
    if (!config.graph.fixtureDir) {
      throw BlastRadiusError.config("graph.mode is 'fixture' but no fixtureDir was given");
    }
    return new FixtureGraphAdapter(config.graph.fixtureDir);
  }
  return new EntireGraphCliAdapter({
    binary: config.graph.binary,
    repo: config.repoPath,
    head: config.graph.useHead,
    profile: config.graph.profile,
    timeoutMs: config.graph.timeoutMs,
    impactDepth: config.graph.impactDepth,
  });
}

function buildIntent(config: ReviewConfig, log: Logger): IntentSource {
  const byName: Record<string, () => IntentSource> = {
    "checkpoint-trailer": () => new CheckpointTrailerIntentSource(),
    "github-issue": () => new GitHubIssueIntentSource(),
    "pr-body": () => new PrBodyIntentSource(),
  };
  const sources = config.intent.order.map((n) => byName[n]!());
  return new CompositeIntentSource(sources, (name, reason) =>
    log("info", `intent source ${name}: ${reason}`),
  );
}

function buildRenderer(format: "markdown" | "json" | "sarif", config: ReviewConfig): Renderer {
  switch (format) {
    case "markdown":
      return new MarkdownRenderer({
        ...(config.render.repoBlobUrlBase !== undefined
          ? { repoBlobUrlBase: config.render.repoBlobUrlBase }
          : {}),
        ...(config.render.suiteTestCount !== undefined
          ? { suiteTestCount: config.render.suiteTestCount }
          : {}),
        ...(config.render.toolUrl !== undefined ? { toolUrl: config.render.toolUrl } : {}),
      });
    case "json":
      return new JsonRenderer();
    case "sarif":
      return new SarifRenderer();
  }
}

function buildSink(to: string, config: ReviewConfig): ReportSink {
  if (to === "stdout") return new StdoutSink();
  if (to === "pr-comment") {
    if (!config.pr.number || !config.pr.repoSlug) {
      throw BlastRadiusError.config("output 'pr-comment' needs pr.number and pr.repoSlug");
    }
    return new GitHubCommentSink({ repoSlug: config.pr.repoSlug, prNumber: config.pr.number });
  }
  return new FileSink(to);
}

function buildOutputs(config: ReviewConfig): { renderer: Renderer; sink: ReportSink }[] {
  return config.outputs.map((o) => ({
    renderer: buildRenderer(o.format, config),
    sink: buildSink(o.to, config),
  }));
}
