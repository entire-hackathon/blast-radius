import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FixtureGraphAdapter } from "../../src/adapters/graph/fixture.js";
import { PrBodyIntentSource } from "../../src/adapters/intent/pr-body.js";
import { MarkdownRenderer } from "../../src/adapters/render/markdown.js";
import { JsonRenderer } from "../../src/adapters/render/json.js";
import { defaultScopeCreepStrategy } from "../../src/domain/scope-creep/index.js";
import { BlastRadiusError, err, ok, type Result } from "../../src/domain/errors.js";
import { runReview } from "../../src/app/review.js";
import type { ReportSink } from "../../src/ports/report-sink.js";
import type { RenderedReport } from "../../src/ports/renderer.js";

const fixtureDir = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../fixtures/mini-scenario",
);

class CaptureSink implements ReportSink {
  readonly kind = "capture";
  last: RenderedReport | null = null;
  async publish(r: RenderedReport): Promise<Result<void>> {
    this.last = r;
    return ok(undefined);
  }
}

class FailingSink implements ReportSink {
  readonly kind = "failing";
  async publish(): Promise<Result<void>> {
    return err(BlastRadiusError.sink("no permission"));
  }
}

describe("runReview (e2e, fixture graph)", () => {
  it("produces the full report and publishes every output", async () => {
    const md = new CaptureSink();
    const json = new CaptureSink();

    const res = await runReview(
      {
        graph: new FixtureGraphAdapter(fixtureDir),
        intent: new PrBodyIntentSource(),
        scopeCreep: defaultScopeCreepStrategy(),
        outputs: [
          { renderer: new MarkdownRenderer(), sink: md },
          { renderer: new JsonRenderer(), sink: json },
        ],
        log: () => {},
        clock: () => new Date("2026-09-06T09:00:00Z"),
      },
      {
        range: { base: "abc123", head: "def456" },
        prContext: {
          repoPath: ".",
          base: "abc123",
          head: "def456",
          prNumber: 1,
          prTitle: "Add rate limiting to the redirect endpoint",
          prBody: "Adds a token bucket limiter for `RedirectController`.",
          repoSlug: "acme/linkshrink",
        },
      },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // the DB signature change is unrelated to a "rate limiting" intent -> flagged
    expect(res.value.hasFindings).toBe(true);
    expect(res.value.report.findings.map((f) => f.symbol.qualifiedName)).toContain(
      "Database.query",
    );

    // a real test in the radius was selected, with a runnable command
    expect(res.value.report.testPlan.selected.length).toBeGreaterThan(0);
    expect(res.value.report.testPlan.command).toMatch(/vitest run/);

    // both outputs published
    expect(res.value.publishedTo).toEqual(["markdown→capture", "json→capture"]);
    expect(md.last?.body).toContain("🧨 Blast Radius");
    expect(md.last?.body).toContain("Database.query");
    expect(JSON.parse(json.last!.body).schemaVersion).toBe("1.0.0");
  });

  it("still runs with no intent, producing radius + tests but no scope section", async () => {
    const md = new CaptureSink();
    const res = await runReview(
      {
        graph: new FixtureGraphAdapter(fixtureDir),
        intent: {
          name: "none",
          get: async () => ok(null),
        },
        scopeCreep: defaultScopeCreepStrategy(),
        outputs: [{ renderer: new MarkdownRenderer(), sink: md }],
        log: () => {},
      },
      {
        range: { base: "abc123", head: "def456" },
        prContext: {
          repoPath: ".",
          base: "abc123",
          head: "def456",
          prNumber: undefined,
          prTitle: undefined,
          prBody: undefined,
          repoSlug: undefined,
        },
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // dependents-threshold still fires without intent (Database.query, 12 deps)
    expect(res.value.report.findings.some((f) => f.strategy.includes("dependents"))).toBe(true);
    expect(md.last?.body).toContain("Intent** — none found");
  });

  it("keeps going when one sink fails, as long as another succeeds", async () => {
    const ok1 = new CaptureSink();
    const res = await runReview(
      {
        graph: new FixtureGraphAdapter(fixtureDir),
        intent: new PrBodyIntentSource(),
        scopeCreep: defaultScopeCreepStrategy(),
        outputs: [
          { renderer: new MarkdownRenderer(), sink: new FailingSink() },
          { renderer: new MarkdownRenderer(), sink: ok1 },
        ],
        log: () => {},
      },
      {
        range: { base: "abc123", head: "def456" },
        prContext: {
          repoPath: ".",
          base: "abc123",
          head: "def456",
          prNumber: 1,
          prTitle: "x",
          prBody: "y",
          repoSlug: undefined,
        },
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.publishedTo).toEqual(["markdown→capture"]);
    expect(res.value.sinkErrors).toEqual([{ sink: "failing", message: "no permission" }]);
    expect(ok1.last).not.toBeNull();
  });
});
