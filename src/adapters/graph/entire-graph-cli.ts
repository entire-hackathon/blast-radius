/**
 * EntireGraphCliAdapter — the real thing. Shells out to `entire-graph`.
 *
 * `execa` with an argv array (never a shell string) so a ref or symbol name
 * cannot inject. Non-zero exit and unparseable stdout both become a
 * `BlastRadiusError`, never a throw.
 */
import { execa, type ExecaError } from "execa";
import { BlastRadiusError, err, ok, type Result } from "../../domain/errors.js";
import { toChangeSet, toRadiusNodes } from "../../domain/graph-mapping.js";
import { rawDiffResult, rawImpactResult } from "../../domain/graph-schema.js";
import type { ChangeSet } from "../../domain/model.js";
import type {
  CommitRange,
  GraphProvider,
  ImpactQuery,
  ImpactResult,
} from "../../ports/graph-provider.js";

export interface EntireGraphCliOptions {
  /** binary name or path (default "entire-graph"). */
  readonly binary?: string;
  /** repo path passed as --repo (default "."). */
  readonly repo?: string;
  /** query the committed tree; recommended in CI where head is a commit. */
  readonly head?: boolean;
  /** parsing profile (default "full" for correctness). */
  readonly profile?: "syntax-only" | "fast" | "full";
  /** per-call timeout ms (default 240000 — a cold index build is slow). */
  readonly timeoutMs?: number;
  /** depth for impact (default 2). */
  readonly impactDepth?: 1 | 2;
}

export class EntireGraphCliAdapter implements GraphProvider {
  readonly kind = "entire-graph-cli";
  private readonly binary: string;
  private readonly repo: string;
  private readonly useHead: boolean;
  private readonly profile: "syntax-only" | "fast" | "full";
  private readonly timeoutMs: number;
  private readonly impactDepth: 1 | 2;

  constructor(opts: EntireGraphCliOptions = {}) {
    this.binary = opts.binary ?? "entire-graph";
    this.repo = opts.repo ?? ".";
    this.useHead = opts.head ?? false;
    this.profile = opts.profile ?? "full";
    this.timeoutMs = opts.timeoutMs ?? 240_000;
    this.impactDepth = opts.impactDepth ?? 2;
  }

  private async run(args: string[]): Promise<Result<unknown>> {
    try {
      const result = await execa(this.binary, args, {
        timeout: this.timeoutMs,
        reject: true,
        stripFinalNewline: true,
      });
      const stdout = String(result.stdout ?? "");
      try {
        return ok(JSON.parse(stdout));
      } catch {
        return err(
          BlastRadiusError.graph(
            `\`${this.binary} ${args[0]}\` did not return JSON`,
            stdout.slice(0, 400),
          ),
        );
      }
    } catch (e) {
      const ex = e as ExecaError;
      if ((ex as { code?: string }).code === "ENOENT") {
        return err(BlastRadiusError.binaryNotFound(this.binary));
      }
      const detail = String(ex.stderr || ex.shortMessage || ex.message || "").slice(0, 400);
      return err(
        BlastRadiusError.graph(
          `\`${this.binary} ${args[0]}\` failed (exit ${ex.exitCode ?? "?"})`,
          detail,
        ),
      );
    }
  }

  async diff(range: CommitRange): Promise<Result<ChangeSet>> {
    const res = await this.run([
      "diff",
      "--repo",
      this.repo,
      "--base",
      range.base,
      "--head",
      range.head,
      "--json",
    ]);
    if (!res.ok) return res;
    const parsed = rawDiffResult.safeParse(res.value);
    if (!parsed.success) {
      return err(BlastRadiusError.schema("diff JSON failed schema", parsed.error.message));
    }
    return ok(toChangeSet(parsed.data));
  }

  async impact(query: ImpactQuery): Promise<Result<ImpactResult>> {
    const args = [
      "impact",
      "--repo",
      this.repo,
      "--symbol",
      query.name,
      "--format",
      "json",
      "--depth",
      String(this.impactDepth),
      "--profile",
      this.profile,
    ];
    if (query.file) args.push("--file", query.file);
    if (query.line) args.push("--line", String(query.line));
    if (this.useHead) args.push("--head");

    const res = await this.run(args);
    if (!res.ok) return res;
    const parsed = rawImpactResult.safeParse(res.value);
    if (!parsed.success) {
      return err(BlastRadiusError.schema("impact JSON failed schema", parsed.error.message));
    }
    return ok({
      nodes: toRadiusNodes(parsed.data, query.name),
      disambiguationRequired: parsed.data.disambiguation_required,
    });
  }
}
