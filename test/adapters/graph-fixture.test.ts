import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FixtureGraphAdapter } from "../../src/adapters/graph/fixture.js";

const dir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../fixtures/mini-scenario");

describe("FixtureGraphAdapter", () => {
  const adapter = new FixtureGraphAdapter(dir);

  it("maps the recorded diff into a ChangeSet", async () => {
    const res = await adapter.diff({ base: "abc123", head: "def456" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const names = res.value.symbols.map((s) => s.ref.qualifiedName);
    expect(names).toEqual([
      "Database.query",
      "RedirectController.handle",
      "TokenBucketRateLimiter",
    ]);
    expect(res.value.symbols[0]?.dependentsCount).toBe(12);
    expect(res.value.changedFiles).toHaveLength(3);
  });

  it("resolves an impact fixture via the manifest and tags the origin", async () => {
    const res = await adapter.impact({
      name: "Database.query",
      file: "src/db/database.ts",
      line: 41,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.nodes.length).toBeGreaterThan(0);
    expect(res.value.nodes.every((n) => n.originSymbols[0] === "Database.query")).toBe(true);
    expect(res.value.nodes.some((n) => n.isTest)).toBe(true);
  });

  it("returns an empty contribution for a symbol with no fixture", async () => {
    const res = await adapter.impact({
      name: "Nonexistent.symbol",
      file: undefined,
      line: undefined,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.nodes).toEqual([]);
  });
});
