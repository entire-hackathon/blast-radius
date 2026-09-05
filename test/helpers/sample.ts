import { reportBuilder } from "../../src/domain/report.js";
import type {
  AnalysisReport,
  BlastRadius,
  ChangeSet,
  Finding,
  IntentModel,
  RadiusSummary,
  TestPlan,
} from "../../src/domain/model.js";

export const sampleIntent: IntentModel = {
  source: "checkpoint-trailer",
  title: "add token-bucket rate limiting to the redirect endpoint",
  body: "add token-bucket rate limiting to the redirect endpoint",
  keywords: ["token", "bucket", "rate", "limit", "redirect", "endpoint"],
  references: ["#42"],
};

const changeSet: ChangeSet = {
  base: "abc123",
  head: "def456",
  checkpoint: "cp_9f2",
  changedFiles: ["src/http/redirect.ts", "src/db/database.ts", "src/service/rate-limit.ts"],
  symbols: [
    {
      ref: {
        name: "query",
        qualifiedName: "Database.query",
        kind: "method",
        file: "src/db/database.ts",
        line: 41,
        language: "TypeScript",
        external: false,
      },
      changeType: "signature_changed",
      dependentsCount: 16,
      oldSignature: "query(sql: string)",
      newSignature: "query(sql: string, opts?: QueryOptions)",
    },
    {
      ref: {
        name: "handle",
        qualifiedName: "RedirectController.handle",
        kind: "method",
        file: "src/http/redirect.ts",
        line: 12,
        language: "TypeScript",
        external: false,
      },
      changeType: "body_changed",
      dependentsCount: 2,
      oldSignature: undefined,
      newSignature: undefined,
    },
  ],
};

const radius: BlastRadius = {
  origin: changeSet.symbols,
  sectionTotals: {
    callers: 3,
    callees: 1,
    type_consumers: 1,
    data_flows: 0,
    co_changes: 0,
    siblings: 0,
  },
  nodes: [
    {
      ref: {
        name: "byId",
        qualifiedName: "LinkRepo.byId",
        kind: "method",
        file: "src/repo/link-repo.ts",
        line: 8,
        language: "TypeScript",
        external: false,
      },
      section: "callers",
      relation: "CALLED_BY",
      direction: "in",
      distance: 1,
      viaChain: [],
      callSite: { file: "src/repo/link-repo.ts", line: 14 },
      originSymbols: ["Database.query"],
      isTest: false,
    },
    {
      ref: {
        name: "database_signature_test",
        qualifiedName: "database_signature_test",
        kind: "function",
        file: "test/database.test.ts",
        line: 20,
        language: "TypeScript",
        external: false,
      },
      section: "callers",
      relation: "CALLED_BY",
      direction: "in",
      distance: 2,
      viaChain: ["LinkRepo.byId"],
      callSite: undefined,
      originSymbols: ["Database.query"],
      isTest: true,
    },
    {
      ref: {
        name: "redirect_ratelimit_test",
        qualifiedName: "redirect_ratelimit_test",
        kind: "function",
        file: "test/redirect.test.ts",
        line: 30,
        language: "TypeScript",
        external: false,
      },
      section: "callers",
      relation: "CALLED_BY",
      direction: "in",
      distance: 1,
      viaChain: [],
      callSite: undefined,
      originSymbols: ["RedirectController.handle"],
      isTest: true,
    },
  ],
};

const summary: RadiusSummary = {
  totalNodes: 3,
  fileCount: 3,
  moduleCount: 2,
  serviceCount: 1,
  testCount: 2,
  byRelation: { CALLED_BY: 3 },
};

const findings: Finding[] = [
  {
    symbol: changeSet.symbols[0]!.ref,
    severity: "high",
    strategy: "keyword-overlap, dependents-threshold",
    reason:
      "no vocabulary overlap with the stated intent; signature changed on a symbol with 16 dependents — run tests first",
    dependentsCount: 16,
    evidence: [
      {
        label: 'intent (checkpoint-trailer): "add token-bucket rate limiting…"',
        location: undefined,
        relationPath: [],
      },
      {
        label: "signature changed: `query(sql)` → `query(sql, opts)`",
        location: "src/db/database.ts:41",
        relationPath: [],
      },
      {
        label: "reaches LinkRepo.byId",
        location: "src/repo/link-repo.ts:8",
        relationPath: ["Database.query", "LinkRepo.byId"],
      },
    ],
  },
];

const testPlan: TestPlan = {
  framework: "vitest",
  selected: [
    {
      ref: radius.nodes[2]!.ref,
      score: 1.5,
      distance: 1,
      coversSymbols: ["RedirectController.handle"],
      framework: "vitest",
    },
    {
      ref: radius.nodes[1]!.ref,
      score: 0.333,
      distance: 2,
      coversSymbols: ["Database.query"],
      framework: "vitest",
    },
  ],
  command:
    'npx vitest run test/redirect.test.ts test/database.test.ts -t "redirect_ratelimit_test|database_signature_test"',
  coverageGaps: [],
};

export function sampleReport(over?: { intent?: IntentModel | null }): AnalysisReport {
  return reportBuilder.build({
    range: { base: "abc123", head: "def456", checkpoint: "cp_9f2" },
    changeSet,
    intent: over && "intent" in over ? over.intent : sampleIntent,
    radius,
    summary,
    findings,
    testPlan,
    now: new Date("2026-09-06T09:00:00Z"),
  });
}
