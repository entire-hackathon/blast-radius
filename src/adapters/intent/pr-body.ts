/**
 * Intent = the PR title + description. The universal fallback: every PR has one.
 */
import { ok, type Result } from "../../domain/errors.js";
import { buildIntentModel } from "../../domain/intent.js";
import type { IntentModel } from "../../domain/model.js";
import type { IntentSource, PrContext } from "../../ports/intent-source.js";

export class PrBodyIntentSource implements IntentSource {
  readonly name = "pr-body";

  async get(ctx: PrContext): Promise<Result<IntentModel | null>> {
    return ok(
      buildIntentModel({
        source: this.name,
        title: ctx.prTitle,
        body: ctx.prBody,
      }),
    );
  }
}
