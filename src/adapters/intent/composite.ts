/**
 * Try each source in order; first non-null wins. Errors from one source are
 * swallowed (logged via `onSkip`) so a flaky `gh` never blocks the review.
 */
import { ok, type Result } from "../../domain/errors.js";
import type { IntentModel } from "../../domain/model.js";
import type { IntentSource, PrContext } from "../../ports/intent-source.js";

export class CompositeIntentSource implements IntentSource {
  readonly name = "composite";
  private readonly sources: readonly IntentSource[];
  private readonly onSkip: (name: string, reason: string) => void;

  constructor(
    sources: readonly IntentSource[],
    onSkip: (name: string, reason: string) => void = () => {},
  ) {
    this.sources = sources;
    this.onSkip = onSkip;
  }

  async get(ctx: PrContext): Promise<Result<IntentModel | null>> {
    for (const source of this.sources) {
      let res;
      try {
        res = await source.get(ctx);
      } catch (e) {
        this.onSkip(source.name, (e as Error).message);
        continue;
      }
      if (!res.ok) {
        this.onSkip(source.name, res.error.message);
        continue;
      }
      if (res.value) return ok(res.value);
      this.onSkip(source.name, "nothing to contribute");
    }
    return ok(null);
  }
}
