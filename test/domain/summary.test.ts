import { describe, expect, it } from "vitest";
import { summarizeRadius } from "../../src/domain/summary.js";
import type { BlastRadius, RadiusNode } from "../../src/domain/model.js";

const node = (over: Partial<RadiusNode> & { file: string }): RadiusNode => ({
  ref: {
    name: "n",
    qualifiedName: over.file,
    kind: "function",
    file: over.file,
    line: 1,
    language: "TypeScript",
    external: false,
  },
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

describe("summarizeRadius", () => {
  it("counts distinct files, modules and tests", () => {
    const s = summarizeRadius(
      radius([
        node({ file: "src/auth/login.ts" }),
        node({ file: "src/auth/token.ts" }),
        node({ file: "src/billing/invoice.ts" }),
        node({ file: "test/auth.test.ts", isTest: true }),
      ]),
    );
    expect(s.totalNodes).toBe(4);
    expect(s.fileCount).toBe(4);
    expect(s.moduleCount).toBe(3); // src/auth, src/billing, test
    expect(s.testCount).toBe(1);
  });

  it("counts services from service-boundary relations", () => {
    const s = summarizeRadius(
      radius([
        node({ file: "svc/orders/api.ts", relation: "HANDLES_ROUTE" }),
        node({ file: "svc/payments/api.ts", relation: "HANDLES_ROUTE" }),
        node({ file: "svc/orders/util.ts", relation: "CALLED_BY" }),
      ]),
    );
    expect(s.serviceCount).toBe(2);
    expect(s.byRelation["HANDLES_ROUTE"]).toBe(2);
    expect(s.byRelation["CALLED_BY"]).toBe(1);
  });
});
