/**
 * The fully-resolved configuration for one `review` run. The CLI builds this
 * (merging flags, env, and GitHub Actions context); the composition root turns
 * it into wired adapters. Nothing downstream reads `process.env`.
 */
import { z } from "zod";

export const renderFormat = z.enum(["markdown", "json", "sarif"]);
export type RenderFormatName = z.infer<typeof renderFormat>;

export const outputTarget = z.object({
  format: renderFormat,
  /** file path, "stdout", or "pr-comment". */
  to: z.string(),
});
export type OutputTarget = z.infer<typeof outputTarget>;

export const reviewConfigSchema = z.object({
  repoPath: z.string().default("."),
  range: z.object({ base: z.string(), head: z.string() }),

  graph: z.object({
    mode: z.enum(["cli", "fixture"]).default("cli"),
    binary: z.string().default("entire-graph"),
    fixtureDir: z.string().optional(),
    useHead: z.boolean().default(false),
    profile: z.enum(["syntax-only", "fast", "full"]).default("full"),
    impactDepth: z.union([z.literal(1), z.literal(2)]).default(2),
    timeoutMs: z.number().int().positive().default(240_000),
  }),

  intent: z.object({
    order: z
      .array(z.enum(["checkpoint-trailer", "github-issue", "pr-body"]))
      .default(["checkpoint-trailer", "github-issue", "pr-body"]),
  }),

  pr: z.object({
    number: z.number().int().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    repoSlug: z.string().optional(),
  }),

  scopeCreep: z.object({
    keywordMaxOverlap: z.number().min(0).max(1).optional(),
    keywordMinDependents: z.number().int().nonnegative().optional(),
    dependentsThreshold: z.number().int().positive().optional(),
  }),

  testSelection: z.object({
    maxTests: z.number().int().positive().default(12),
  }),

  summary: z.object({
    moduleDepth: z.number().int().positive().default(2),
  }),

  render: z.object({
    repoBlobUrlBase: z.string().optional(),
    suiteTestCount: z.number().int().positive().optional(),
    toolUrl: z.string().optional(),
  }),

  outputs: z.array(outputTarget).min(1),
  failOnFindings: z.boolean().default(false),
});

export type ReviewConfig = z.infer<typeof reviewConfigSchema>;

export function parseReviewConfig(input: unknown): ReviewConfig {
  return reviewConfigSchema.parse(input);
}
