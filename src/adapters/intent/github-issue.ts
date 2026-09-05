/**
 * Intent = a linked issue. Parse `#123` / `Closes #123` from the PR body and
 * ask `gh` for the issue's title + body.
 */
import { execa } from "execa";
import { z } from "zod";
import { ok, type Result } from "../../domain/errors.js";
import { buildIntentModel } from "../../domain/intent.js";
import { extractIssueRefs } from "../../domain/intent-keywords.js";
import type { IntentModel } from "../../domain/model.js";
import type { IntentSource, PrContext } from "../../ports/intent-source.js";

const ghIssueSchema = z.object({ title: z.string(), body: z.string().nullable().default("") });

export interface GitHubIssueOptions {
  readonly ghBinary?: string;
}

export class GitHubIssueIntentSource implements IntentSource {
  readonly name = "github-issue";
  private readonly gh: string;

  constructor(opts: GitHubIssueOptions = {}) {
    this.gh = opts.ghBinary ?? "gh";
  }

  async get(ctx: PrContext): Promise<Result<IntentModel | null>> {
    const refs = extractIssueRefs(`${ctx.prTitle ?? ""}\n${ctx.prBody ?? ""}`).filter((r) =>
      r.startsWith("#"),
    );
    if (refs.length === 0) return ok(null);

    const number = refs[0]!.slice(1);
    try {
      const args = ["issue", "view", number, "--json", "title,body"];
      if (ctx.repoSlug) args.push("--repo", ctx.repoSlug);
      const { stdout } = await execa(this.gh, args, { reject: true });
      const parsed = ghIssueSchema.safeParse(JSON.parse(stdout));
      if (!parsed.success) return ok(null);
      const model: IntentModel | null = buildIntentModel({
        source: this.name,
        title: parsed.data.title,
        body: parsed.data.body ?? "",
        extraReferences: [`#${number}`],
      });
      return ok(model);
    } catch {
      return ok(null); // gh not available / not authed / issue not found — just skip
    }
  }
}
