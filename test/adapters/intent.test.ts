import { describe, expect, it } from "vitest";
import { CompositeIntentSource } from "../../src/adapters/intent/composite.js";
import { PrBodyIntentSource } from "../../src/adapters/intent/pr-body.js";
import { ok, type Result } from "../../src/domain/errors.js";
import type { IntentModel } from "../../src/domain/model.js";
import type { IntentSource, PrContext } from "../../src/ports/intent-source.js";

const ctx = (over: Partial<PrContext> = {}): PrContext => ({
  repoPath: ".",
  base: "main",
  head: "HEAD",
  prNumber: 7,
  prTitle: "Add rate limiting to redirect endpoint",
  prBody: "Closes #42. Adds a token bucket limiter to `RedirectController`.",
  repoSlug: "acme/linkshrink",
  ...over,
});

const fake = (name: string, value: IntentModel | null, throws = false): IntentSource => ({
  name,
  get: async (): Promise<Result<IntentModel | null>> => {
    if (throws) throw new Error("boom");
    return ok(value);
  },
});

describe("PrBodyIntentSource", () => {
  it("builds an intent from the PR title + body with keywords and issue refs", async () => {
    const res = await new PrBodyIntentSource().get(ctx());
    expect(res.ok).toBe(true);
    if (!res.ok || !res.value) throw new Error("expected intent");
    expect(res.value.source).toBe("pr-body");
    expect(res.value.keywords).toEqual(expect.arrayContaining(["rate", "limit", "redirect"]));
    expect(res.value.references).toContain("#42");
  });

  it("returns null when there is no title or body", async () => {
    const res = await new PrBodyIntentSource().get(ctx({ prTitle: undefined, prBody: undefined }));
    expect(res).toEqual(ok(null));
  });
});

describe("CompositeIntentSource", () => {
  it("returns the first source that yields a model", async () => {
    const skips: string[] = [];
    const composite = new CompositeIntentSource(
      [
        fake("checkpoint-trailer", null),
        fake("github-issue", {
          source: "github-issue",
          title: "t",
          body: "b",
          keywords: ["k"],
          references: [],
        }),
        fake("pr-body", { source: "pr-body", title: "x", body: "y", keywords: [], references: [] }),
      ],
      (name) => skips.push(name),
    );
    const res = await composite.get(ctx());
    expect(res.ok && res.value?.source).toBe("github-issue");
    expect(skips).toEqual(["checkpoint-trailer"]);
  });

  it("swallows a throwing source and moves on", async () => {
    const skips: string[] = [];
    const composite = new CompositeIntentSource(
      [
        fake("checkpoint-trailer", null, true),
        fake("pr-body", { source: "pr-body", title: "x", body: "y", keywords: [], references: [] }),
      ],
      (name, reason) => skips.push(`${name}:${reason}`),
    );
    const res = await composite.get(ctx());
    expect(res.ok && res.value?.source).toBe("pr-body");
    expect(skips[0]).toMatch(/checkpoint-trailer:boom/);
  });

  it("returns ok(null) when no source has anything", async () => {
    const composite = new CompositeIntentSource([fake("a", null), fake("b", null)]);
    expect(await composite.get(ctx())).toEqual(ok(null));
  });
});
