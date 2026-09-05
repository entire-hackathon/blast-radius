/**
 * Upsert exactly one PR comment.
 *
 * Finds the previous Blast Radius comment by its marker and PATCHes it;
 * otherwise POSTs a new one. Re-running on every push therefore updates one
 * comment instead of burying the thread. Uses `gh api` (argv, never a shell
 * string); auth is whatever `gh`/`GH_TOKEN` already provides.
 */
import { execa } from "execa";
import { z } from "zod";
import { BlastRadiusError, err, ok, type Result } from "../../domain/errors.js";
import type { ReportSink } from "../../ports/report-sink.js";
import type { RenderedReport } from "../../ports/renderer.js";

const commentsSchema = z.array(z.object({ id: z.number(), body: z.string().nullable() }));

export interface GitHubCommentSinkOptions {
  readonly repoSlug: string;
  readonly prNumber: number;
  readonly ghBinary?: string;
}

export class GitHubCommentSink implements ReportSink {
  readonly kind = "github-comment";
  private readonly slug: string;
  private readonly pr: number;
  private readonly gh: string;

  constructor(opts: GitHubCommentSinkOptions) {
    this.slug = opts.repoSlug;
    this.pr = opts.prNumber;
    this.gh = opts.ghBinary ?? "gh";
  }

  async publish(rendered: RenderedReport): Promise<Result<void>> {
    if (!rendered.marker) {
      return err(BlastRadiusError.sink("github-comment sink needs a marked report (markdown)"));
    }
    try {
      const existingId = await this.findExisting(rendered.marker);
      if (existingId !== null) {
        await this.api("PATCH", `repos/${this.slug}/issues/comments/${existingId}`, rendered.body);
      } else {
        await this.api("POST", `repos/${this.slug}/issues/${this.pr}/comments`, rendered.body);
      }
      return ok(undefined);
    } catch (e) {
      return err(
        BlastRadiusError.sink("could not upsert PR comment", (e as Error).message.slice(0, 300)),
      );
    }
  }

  private async findExisting(marker: string): Promise<number | null> {
    const { stdout } = await execa(
      this.gh,
      ["api", `repos/${this.slug}/issues/${this.pr}/comments?per_page=100`],
      { reject: true },
    );
    const parsed = commentsSchema.safeParse(JSON.parse(stdout));
    if (!parsed.success) return null;
    return parsed.data.find((c) => c.body?.includes(marker))?.id ?? null;
  }

  private async api(method: "POST" | "PATCH", path: string, body: string): Promise<void> {
    await execa(this.gh, ["api", "--method", method, path, "-f", `body=${body}`], { reject: true });
  }
}
