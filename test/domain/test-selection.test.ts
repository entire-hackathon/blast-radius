import { describe, expect, it } from "vitest";
import { selectTests } from "../../src/domain/test-selection.js";
import type { BlastRadius, ChangedSymbol, RadiusNode, SymbolRef } from "../../src/domain/model.js";

const testRef = (name: string, file: string, lang = "TypeScript"): SymbolRef => ({
  name,
  qualifiedName: name,
  kind: "function",
  file,
  line: 1,
  language: lang,
  external: false,
});

const testNode = (over: Partial<RadiusNode> & { ref: SymbolRef }): RadiusNode => ({
  section: "callers",
  relation: "CALLED_BY",
  direction: "in",
  distance: 1,
  viaChain: [],
  callSite: undefined,
  originSymbols: ["A"],
  isTest: true,
  ...over,
});

const changed = (qualifiedName: string): ChangedSymbol => ({
  ref: { ...testRef(qualifiedName, `src/${qualifiedName}.ts`), kind: "method" },
  changeType: "body_changed",
  dependentsCount: 1,
  oldSignature: undefined,
  newSignature: undefined,
});

const radius = (nodes: RadiusNode[]): BlastRadius => ({
  origin: [],
  nodes,
  sectionTotals: {
    callers: 0,
    callees: 0,
    type_consumers: 0,
    data_flows: 0,
    co_changes: 0,
    siblings: 0,
  },
});

describe("selectTests", () => {
  it("prefers closer tests and stops once every changed symbol is covered", () => {
    const plan = selectTests(
      radius([
        testNode({ ref: testRef("directTest", "test/a.test.ts"), distance: 1, originSymbols: ["A"] }),
        testNode({ ref: testRef("farTest", "test/a2.test.ts"), distance: 3, originSymbols: ["A"] }),
        testNode({ ref: testRef("bTest", "test/b.test.ts"), distance: 2, originSymbols: ["B"] }),
      ]),
      [changed("A"), changed("B")],
    );
    expect(plan.selected.map((t) => t.ref.name)).toEqual(["directTest", "bTest"]);
    expect(plan.coverageGaps).toEqual([]);
  });

  it("reports changed symbols that no test reaches as coverage gaps", () => {
    const plan = selectTests(
      radius([testNode({ ref: testRef("aTest", "test/a.test.ts"), originSymbols: ["A"] })]),
      [changed("A"), changed("Uncovered")],
    );
    expect(plan.coverageGaps).toEqual(["Uncovered"]);
  });

  it("synthesises a vitest command with files and -t names", () => {
    const plan = selectTests(
      radius([
        testNode({ ref: testRef("redirects", "test/redirect.test.ts"), originSymbols: ["A"] }),
        testNode({ ref: testRef("rateLimits", "test/rate.test.ts"), originSymbols: ["B"] }),
      ]),
      [changed("A"), changed("B")],
    );
    expect(plan.framework).toBe("vitest");
    expect(plan.command).toBe(
      'npx vitest run test/redirect.test.ts test/rate.test.ts -t "redirects|rateLimits"',
    );
  });

  it("synthesises a go command grouped by package dir", () => {
    const plan = selectTests(
      radius([
        testNode({
          ref: testRef("TestRedirect", "internal/http/redirect_test.go", "Go"),
          originSymbols: ["A"],
        }),
        testNode({
          ref: testRef("TestRepo", "internal/repo/repo_test.go", "Go"),
          originSymbols: ["B"],
        }),
      ]),
      [changed("A"), changed("B")],
    );
    expect(plan.framework).toBe("go");
    expect(plan.command).toBe(
      "go test -run '^(TestRedirect|TestRepo)$' ./internal/http/... ./internal/repo/...",
    );
  });

  it("returns no command and all gaps when the radius has no tests", () => {
    const plan = selectTests(radius([]), [changed("A")]);
    expect(plan.selected).toEqual([]);
    expect(plan.command).toBeNull();
    expect(plan.coverageGaps).toEqual(["A"]);
  });
});
