#!/usr/bin/env node
/**
 * Blast Radius CLI. Parses flags, folds in GitHub Actions context when present,
 * builds a `ReviewConfig`, and runs the `review` use-case through the
 * composition root.
 */
import { Command, Option } from "commander";
import { readGitHubContext } from "./app/github-context.js";
import { parseReviewConfig, type OutputTarget } from "./app/config.js";
import { runReview } from "./app/review.js";
import { composeReview, type Logger } from "./composition-root.js";
import { BlastRadiusError } from "./domain/errors.js";

const program = new Command();

program
  .name("blast-radius")
  .description("Impact-aware PR review powered by Entire Graph")
  .version("0.1.0");

program
  .command("review")
  .description("analyse a commit range and report the blast radius, scope drift and test set")
  .option("--base <ref>", "base revision")
  .option("--head <ref>", "head revision")
  .option("--repo <path>", "repository path", ".")
  .option("--fixture <dir>", "use recorded entire-graph JSON instead of the binary")
  .option("--entire-graph <bin>", "entire-graph binary name or path", "entire-graph")
  .option("--graph-head", "query entire-graph's committed tree (--head)")
  .addOption(
    new Option("--profile <p>", "entire-graph parse profile")
      .choices(["syntax-only", "fast", "full"])
      .default("full"),
  )
  .option("--format <fmt...>", "output formats: markdown, json, sarif", ["markdown"])
  .option("--markdown-out <file>", "write markdown here instead of stdout")
  .option("--json-out <file>", "write json here")
  .option("--sarif-out <file>", "write sarif here")
  .option("--comment", "upsert the markdown report as a PR comment")
  .option("--intent-source <list>", "comma list: checkpoint-trailer,github-issue,pr-body")
  .option("--pr <number>", "pull request number", (v) => parseInt(v, 10))
  .option("--pr-title <s>", "pull request title (intent source)")
  .option("--pr-body <s>", "pull request body (intent source)")
  .option("--repo-slug <owner/repo>", "for gh lookups and blob links")
  .option("--blob-url-base <url>", "https://host/owner/repo/blob/<sha> for clickable links")
  .option("--suite-test-count <n>", "total tests in the suite, for '6 of ~N'", (v) =>
    parseInt(v, 10),
  )
  .option("--dependents-threshold <n>", "wide-reaching-change threshold", (v) => parseInt(v, 10))
  .option("--max-tests <n>", "cap on recommended tests", (v) => parseInt(v, 10))
  .option("--fail-on-findings", "exit non-zero when scope findings exist")
  .option("--quiet", "suppress progress logs on stderr")
  .action(async (opts) => {
    const gh = readGitHubContext();

    const base = opts.base ?? gh?.base ?? "origin/main";
    const head = opts.head ?? gh?.head ?? "HEAD";

    const outputs: OutputTarget[] = [];
    const formats = new Set(opts.format as string[]);
    if (opts.comment) formats.add("markdown");
    if (opts.markdownOut) formats.add("markdown");
    if (opts.jsonOut) formats.add("json");
    if (opts.sarifOut) formats.add("sarif");

    for (const fmt of formats) {
      if (fmt === "markdown") {
        // markdown can fan out to several targets at once
        const targets = new Set<string>();
        if (opts.markdownOut) targets.add(opts.markdownOut);
        if (opts.comment) targets.add("pr-comment");
        if (targets.size === 0) targets.add("stdout");
        for (const to of targets) outputs.push({ format: "markdown", to });
      } else if (fmt === "json") {
        outputs.push({ format: "json", to: opts.jsonOut ?? "stdout" });
      } else if (fmt === "sarif") {
        outputs.push({ format: "sarif", to: opts.sarifOut ?? "blast-radius.sarif" });
      }
    }

    const log: Logger = opts.quiet
      ? () => {}
      : (level, msg) => process.stderr.write(`[blast-radius] ${level}: ${msg}\n`);

    try {
      const config = parseReviewConfig({
        repoPath: opts.repo,
        range: { base, head },
        graph: {
          mode: opts.fixture ? "fixture" : "cli",
          binary: opts.entireGraph,
          fixtureDir: opts.fixture,
          useHead: Boolean(opts.graphHead),
          profile: opts.profile,
        },
        intent: {
          order: opts.intentSource
            ? (opts.intentSource as string).split(",").map((s) => s.trim())
            : undefined,
        },
        pr: {
          number: opts.pr ?? gh?.prNumber,
          title: opts.prTitle ?? gh?.prTitle,
          body: opts.prBody ?? gh?.prBody,
          repoSlug: opts.repoSlug ?? gh?.repoSlug,
        },
        scopeCreep: {
          ...(opts.dependentsThreshold ? { dependentsThreshold: opts.dependentsThreshold } : {}),
        },
        testSelection: { ...(opts.maxTests ? { maxTests: opts.maxTests } : {}) },
        summary: {},
        render: {
          ...(opts.blobUrlBase || gh?.repoBlobUrlBase
            ? { repoBlobUrlBase: opts.blobUrlBase ?? gh?.repoBlobUrlBase }
            : {}),
          ...(opts.suiteTestCount ? { suiteTestCount: opts.suiteTestCount } : {}),
          toolUrl: "[Blast Radius](https://github.com/entire-hackathon/blast-radius)",
        },
        outputs,
        failOnFindings: Boolean(opts.failOnFindings),
      });

      const { deps, request } = composeReview(config, log);
      const result = await runReview(deps, request);

      if (!result.ok) {
        process.stderr.write(`\n✖ ${result.error.message}\n`);
        if (result.error.detail) process.stderr.write(`  ${result.error.detail}\n`);
        process.exitCode = 2;
        return;
      }

      log("info", `published: ${result.value.publishedTo.join(", ") || "(nothing)"}`);
      for (const se of result.value.sinkErrors) {
        process.stderr.write(`\n⚠ ${se.sink}: ${se.message}\n`);
      }
      if (config.failOnFindings && result.value.hasFindings) {
        process.stderr.write(`\n✖ ${result.value.report.findings.length} scope finding(s)\n`);
        process.exitCode = 1;
      }
    } catch (e) {
      const msg = e instanceof BlastRadiusError ? e.message : (e as Error).message;
      process.stderr.write(`\n✖ ${msg}\n`);
      process.exitCode = 2;
    }
  });

program.parseAsync().catch((e) => {
  process.stderr.write(`\n✖ ${(e as Error).message}\n`);
  process.exitCode = 2;
});
