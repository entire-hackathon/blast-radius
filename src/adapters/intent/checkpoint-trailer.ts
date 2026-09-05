/**
 * Intent = the originating Entire session.
 *
 * `git log` the head commit for an `Entire-Checkpoint: <id>` trailer. If found,
 * that id becomes the range checkpoint, and — when the repo carries a captured
 * prompt at `.entire/intent/<id>.json` (`{ "prompt": "..." }` or
 * `{ "title": "...", "body": "..." }`) — that text is the stated intent, which
 * is the real ask, not a reconstruction.
 *
 * This is the "Connecting Graph findings with Checkpoint intent" direction from
 * the brief made concrete.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { z } from "zod";
import { ok, type Result } from "../../domain/errors.js";
import { buildIntentModel } from "../../domain/intent.js";
import type { IntentModel } from "../../domain/model.js";
import type { IntentSource, PrContext } from "../../ports/intent-source.js";

const TRAILER_RE = /Entire-Checkpoint:\s*([A-Za-z0-9._-]+)/;

const capturedIntentSchema = z.object({
  prompt: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  summary: z.string().optional(),
});

export interface CheckpointTrailerOptions {
  readonly gitBinary?: string;
}

export class CheckpointTrailerIntentSource implements IntentSource {
  readonly name = "checkpoint-trailer";
  private readonly git: string;

  constructor(opts: CheckpointTrailerOptions = {}) {
    this.git = opts.gitBinary ?? "git";
  }

  async get(ctx: PrContext): Promise<Result<IntentModel | null>> {
    const id = await this.readTrailer(ctx);
    if (!id) return ok(null);

    const captured = await this.readCapturedIntent(ctx.repoPath, id);
    if (captured) {
      const model = buildIntentModel({
        source: this.name,
        title: captured.title ?? captured.summary,
        body: captured.body ?? captured.prompt,
        extraReferences: [id],
      });
      if (model) return ok(model);
    }

    // trailer present but no captured text: still useful — record the link,
    // fall back to the commit subject as a thin intent.
    const subject = await this.headSubject(ctx);
    return ok(
      buildIntentModel({
        source: this.name,
        title: subject,
        body: `Entire checkpoint ${id}`,
        extraReferences: [id],
      }),
    );
  }

  private async readTrailer(ctx: PrContext): Promise<string | null> {
    try {
      const { stdout } = await execa(
        this.git,
        ["-C", ctx.repoPath, "log", "-1", "--format=%B", ctx.head],
        { reject: true },
      );
      return TRAILER_RE.exec(stdout)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  private async headSubject(ctx: PrContext): Promise<string | undefined> {
    try {
      const { stdout } = await execa(
        this.git,
        ["-C", ctx.repoPath, "log", "-1", "--format=%s", ctx.head],
        { reject: true },
      );
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async readCapturedIntent(
    repoPath: string,
    id: string,
  ): Promise<z.infer<typeof capturedIntentSchema> | null> {
    for (const rel of [`.entire/intent/${id}.json`, `.entire/intents/${id}.json`]) {
      try {
        const raw = await readFile(path.resolve(repoPath, rel), "utf8");
        const parsed = capturedIntentSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
      } catch {
        // try the next location
      }
    }
    return null;
  }
}
