import { describe, expect, it } from "vitest";
import {
  extractKeywords,
  keywordOverlap,
  splitIdentifier,
  stem,
  symbolTokens,
} from "../../src/domain/intent-keywords.js";

describe("splitIdentifier", () => {
  it("splits camelCase, snake_case, paths and dots", () => {
    expect(splitIdentifier("RedirectService.handleRequest")).toEqual([
      "redirect",
      "service",
      "handle",
      "request",
    ]);
    expect(splitIdentifier("src/repo/link_repo.ts")).toEqual([
      "src",
      "repo",
      "link",
      "repo",
      "ts",
    ]);
    expect(splitIdentifier("HTTPServerError")).toEqual(["http", "server", "error"]);
  });
});

describe("stem", () => {
  it("collapses common inflections", () => {
    expect(stem("limiting")).toBe(stem("limiter"));
    expect(stem("limits")).toBe(stem("limit"));
  });
});

describe("extractKeywords", () => {
  it("keeps meaningful terms, drops stopwords and verbs-of-intent", () => {
    const kw = extractKeywords("Add token-bucket rate limiting to the redirect endpoint");
    expect(kw).toContain("token");
    expect(kw).toContain("bucket");
    expect(kw).toContain("rate");
    expect(kw).toContain("redirect");
    expect(kw).toContain("endpoint");
    expect(kw).not.toContain("add");
    expect(kw).not.toContain("the");
  });

  it("weights backticked code spans", () => {
    const kw = extractKeywords("wire up `RateLimiter` in the handler");
    expect(kw).toContain("rate");
    expect(kw).toContain("limit");
  });
});

describe("keywordOverlap", () => {
  const intent = extractKeywords("add rate limiting to the redirect endpoint");

  it("is high for a symbol that matches the intent", () => {
    const { overlap } = keywordOverlap("RedirectService.rateLimit", "src/redirect.ts", intent);
    expect(overlap).toBeGreaterThan(0.5);
  });

  it("is zero for a symbol unrelated to the intent", () => {
    const { overlap, shared } = keywordOverlap("Database.query", "src/db/database.ts", intent);
    expect(overlap).toBe(0);
    expect(shared).toEqual([]);
  });
});

describe("symbolTokens", () => {
  it("drops layout-only path segments", () => {
    const tokens = symbolTokens("query", "src/internal/db/database.ts");
    expect(tokens.has("src")).toBe(false);
    expect(tokens.has("internal")).toBe(false);
    expect(tokens.has("database")).toBe(true);
  });
});
