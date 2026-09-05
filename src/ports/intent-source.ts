/**
 * IntentSource port — where the "stated intent" of a change comes from.
 *
 * Ordered adapters are tried in turn (see CompositeIntentSource); the first one
 * that yields something wins and its `name` is recorded on the IntentModel so
 * the report can say "source: checkpoint-trailer". A source that has nothing to
 * say returns `ok(null)`, not an error.
 */
import type { Result } from "../domain/errors.js";
import type { IntentModel } from "../domain/model.js";

export interface PrContext {
  readonly repoPath: string;
  readonly base: string;
  readonly head: string;
  readonly prNumber: number | undefined;
  readonly prTitle: string | undefined;
  readonly prBody: string | undefined;
  /** "owner/repo", for `gh` lookups. */
  readonly repoSlug: string | undefined;
}

export interface IntentSource {
  readonly name: string;
  get(ctx: PrContext): Promise<Result<IntentModel | null>>;
}
