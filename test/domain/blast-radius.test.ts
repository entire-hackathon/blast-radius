import { describe, expect, it } from "vitest";
import { computeBlastRadius } from "../../src/domain/blast-radius.js";
import type { ChangedSymbol, RadiusNode, SymbolRef } from "../../src/domain/model.js";

const ref = (over: Partial<SymbolRef> & { qualifiedName: string }): SymbolRef => ({
  name: over.qualifiedName,
  kind: "function",
  file: `src/${over.qualifiedName}.ts`,
  line: 1,
  language: "TypeScript",
  external: false,
  ...over,
});

const changed = (qualifiedName: string, dependents = 1): ChangedSymbol => ({
  ref: ref({ qualifiedName }),
  changeType: "body_changed",
  dependentsCount: dependents,
  oldSignature: undefined,
  newSignature: undefined,
});

const node = (over: Partial<RadiusNode> & { qualifiedName: string }): RadiusNode => ({
  ref: ref({ qualifiedName: over.qualifiedName, file: over.qualifiedName + ".ts" }),
  section: "callers",
  relation: "CALLED_BY",
  direction: "in",
  distance: 1,
  viaChain: [],
  callSite: undefined,
  originSymbols: ["X"],
  isTest: false,
  ...over,
});

describe("computeBlastRadius", () => {
  it("dedupes a node reached from two changed symbols, keeping min distance and union of origins", () => {
    const radius = computeBlastRadius(
      [changed("A"), changed("B")],
      [
        [node({ qualifiedName: "shared", distance: 3, originSymbols: ["A"] })],
        [node({ qualifiedName: "shared", distance: 1, originSymbols: ["B"] })],
      ],
    );
    expect(radius.nodes).toHaveLength(1);
    expect(radius.nodes[0]?.distance).toBe(1);
    expect([...(radius.nodes[0]?.originSymbols ?? [])].sort()).toEqual(["A", "B"]);
  });

  it("drops a node that is itself one of the changed symbols", () => {
    const radius = computeBlastRadius(
      [changed("A")],
      [[node({ qualifiedName: "A" }), node({ qualifiedName: "downstream" })]],
    );
    expect(radius.nodes.map((n) => n.ref.qualifiedName)).toEqual(["downstream"]);
  });

  it("drops external callees but keeps external type consumers", () => {
    const radius = computeBlastRadius(
      [changed("A")],
      [
        [
          node({
            qualifiedName: "fmt.Errorf",
            section: "callees",
            relation: "CALLS",
            ref: { ...ref({ qualifiedName: "fmt.Errorf" }), external: true, file: undefined },
          }),
          node({
            qualifiedName: "SomeType",
            section: "type_consumers",
            relation: "USES_TYPE",
            ref: { ...ref({ qualifiedName: "SomeType" }), external: true, file: undefined },
          }),
        ],
      ],
    );
    expect(radius.nodes.map((n) => n.ref.qualifiedName)).toEqual(["SomeType"]);
  });

  it("counts section totals over distinct nodes", () => {
    const radius = computeBlastRadius(
      [changed("A")],
      [
        [
          node({ qualifiedName: "c1", section: "callers" }),
          node({ qualifiedName: "c2", section: "callers" }),
          node({ qualifiedName: "t1", section: "type_consumers", relation: "USES_TYPE" }),
        ],
      ],
    );
    expect(radius.sectionTotals.callers).toBe(2);
    expect(radius.sectionTotals.type_consumers).toBe(1);
    expect(radius.sectionTotals.data_flows).toBe(0);
  });

  it("orders nodes by distance then name", () => {
    const radius = computeBlastRadius(
      [changed("A")],
      [
        [
          node({ qualifiedName: "far", distance: 2 }),
          node({ qualifiedName: "zeb", distance: 1 }),
          node({ qualifiedName: "abe", distance: 1 }),
        ],
      ],
    );
    expect(radius.nodes.map((n) => n.ref.qualifiedName)).toEqual(["abe", "zeb", "far"]);
  });
});
