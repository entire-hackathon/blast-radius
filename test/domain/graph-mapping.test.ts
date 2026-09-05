import { describe, expect, it } from "vitest";
import { rawDiffResult, rawImpactResult } from "../../src/domain/graph-schema.js";
import { toChangeSet, toRadiusNodes, toSymbolRef } from "../../src/domain/graph-mapping.js";

describe("toSymbolRef", () => {
  it("falls back to name when qualified_name is absent", () => {
    const ref = toSymbolRef({ id: "x", name: "query", external: false } as never);
    expect(ref.qualifiedName).toBe("query");
    expect(ref.external).toBe(false);
  });
});

describe("toChangeSet", () => {
  it("keeps symbol rows, drops module rows, and collects files", () => {
    const raw = rawDiffResult.parse({
      base: "main",
      head: "HEAD",
      files: [
        {
          path: "src/db.ts",
          status: "M",
          language: "TypeScript",
          changes: [
            { type: "body_changed", kind: "module", name: "src/db.ts", dependents_count: 0 },
            {
              type: "signature_changed",
              kind: "method",
              name: "Database.query",
              old_signature: "query(sql)",
              new_signature: "query(sql, opts)",
              after_start_line: 41,
              dependents_count: 9,
            },
          ],
        },
      ],
    });
    const cs = toChangeSet(raw);
    expect(cs.symbols).toHaveLength(1);
    expect(cs.symbols[0]?.ref.qualifiedName).toBe("Database.query");
    expect(cs.symbols[0]?.dependentsCount).toBe(9);
    expect(cs.symbols[0]?.ref.line).toBe(41);
    expect(cs.changedFiles).toEqual(["src/db.ts"]);
  });

  it("maps a RENAMED reconciliation to changeType 'renamed'", () => {
    const raw = rawDiffResult.parse({
      base: "a",
      head: "b",
      files: [
        {
          path: "s.ts",
          status: "M",
          changes: [
            {
              type: "body_changed",
              kind: "function",
              name: "old",
              new_name: "renamedFn",
              reconciliation: "RENAMED",
              dependents_count: 1,
            },
          ],
        },
      ],
    });
    const cs = toChangeSet(raw);
    expect(cs.symbols[0]?.changeType).toBe("renamed");
    expect(cs.symbols[0]?.ref.name).toBe("renamedFn");
  });
});

describe("toRadiusNodes", () => {
  const raw = rawImpactResult.parse({
    query: "query",
    callers: {
      total: 2,
      entries: [
        {
          endpoint: {
            id: "1",
            name: "byId",
            qualified_name: "LinkRepo.byId",
            file_path: "src/repo.ts",
            start_line: 12,
          },
          relation: "CALLS",
          direction: "in",
          depth: 1,
          call_site: { file_path: "src/repo.ts", line: 18 },
        },
        {
          endpoint: {
            id: "2",
            name: "redirect_test",
            qualified_name: "redirect_test",
            file_path: "test/redirect.test.ts",
            start_line: 4,
          },
          relation: "CALLS",
          direction: "in",
          depth: 2,
          via: "LinkRepo.byId",
        },
      ],
    },
    callees: {
      total: 1,
      entries: [
        {
          endpoint: { id: "3", name: "Errorf", qualified_name: "fmt.Errorf", external: true },
          relation: "CALLS",
          direction: "out",
        },
      ],
    },
  });

  it("maps every section entry and tags the origin symbol", () => {
    const nodes = toRadiusNodes(raw, "Database.query");
    expect(nodes).toHaveLength(3);
    expect(nodes.every((n) => n.originSymbols[0] === "Database.query")).toBe(true);
  });

  it("classifies a *.test.ts caller as a test node", () => {
    const nodes = toRadiusNodes(raw, "Database.query");
    const test = nodes.find((n) => n.ref.qualifiedName === "redirect_test");
    expect(test?.isTest).toBe(true);
    expect(test?.distance).toBe(2);
    expect(test?.viaChain).toEqual(["LinkRepo.byId"]);
  });

  it("preserves the call site when present", () => {
    const nodes = toRadiusNodes(raw, "Database.query");
    const repo = nodes.find((n) => n.ref.qualifiedName === "LinkRepo.byId");
    expect(repo?.callSite).toEqual({ file: "src/repo.ts", line: 18 });
  });
});
