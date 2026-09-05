import { describe, expect, it } from "vitest";
import { extractKeywords } from "../../src/domain/intent-keywords.js";
import type { BlastRadius, ChangeSet, ChangedSymbol, IntentModel } from "../../src/domain/model.js";
import {
  CompositeStrategy,
  DependentsThresholdStrategy,
  KeywordOverlapStrategy,
  defaultScopeCreepStrategy,
} from "../../src/domain/scope-creep/index.js";

const intent = (text: string): IntentModel => ({
  source: "pr-body",
  title: text,
  body: text,
  keywords: extractKeywords(text),
  references: [],
});

const changed = (
  qualifiedName: string,
  dependentsCount: number,
  over: Partial<ChangedSymbol> = {},
): ChangedSymbol => ({
  ref: {
    name: qualifiedName.split(".").pop() ?? qualifiedName,
    qualifiedName,
    kind: "method",
    file: `src/${qualifiedName.split(".")[0]?.toLowerCase()}.ts`,
    line: 10,
    language: "TypeScript",
    external: false,
  },
  changeType: "body_changed",
  dependentsCount,
  oldSignature: undefined,
  newSignature: undefined,
  ...over,
});

const changeSet = (symbols: ChangedSymbol[]): ChangeSet => ({
  base: "main",
  head: "HEAD",
  checkpoint: undefined,
  symbols,
  changedFiles: [...new Set(symbols.map((s) => s.ref.file!).filter(Boolean))],
});

const emptyRadius: BlastRadius = {
  origin: [],
  nodes: [],
  sectionTotals: {
    callers: 0,
    callees: 0,
    type_consumers: 0,
    data_flows: 0,
    co_changes: 0,
    siblings: 0,
  },
};

describe("KeywordOverlapStrategy", () => {
  const strat = new KeywordOverlapStrategy();

  it("stays silent without an intent", () => {
    expect(
      strat.evaluate({ intent: null, changeSet: changeSet([changed("Database.query", 9)]), radius: emptyRadius }),
    ).toEqual([]);
  });

  it("does not flag a symbol that matches the intent", () => {
    const findings = strat.evaluate({
      intent: intent("add rate limiting to the redirect endpoint"),
      changeSet: changeSet([changed("RedirectService.rateLimit", 5)]),
      radius: emptyRadius,
    });
    expect(findings).toEqual([]);
  });

  it("flags an unrelated change with enough dependents", () => {
    const findings = strat.evaluate({
      intent: intent("add rate limiting to the redirect endpoint"),
      changeSet: changeSet([changed("Database.query", 9, { changeType: "signature_changed" })]),
      radius: emptyRadius,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.symbol.qualifiedName).toBe("Database.query");
    expect(findings[0]?.strategy).toBe("keyword-overlap");
    expect(findings[0]?.reason).toMatch(/no vocabulary overlap/);
  });

  it("ignores an unrelated change with too few dependents", () => {
    const findings = strat.evaluate({
      intent: intent("add rate limiting to the redirect endpoint"),
      changeSet: changeSet([changed("Logger.debug", 1)]),
      radius: emptyRadius,
    });
    expect(findings).toEqual([]);
  });

  it("never flags newly added symbols", () => {
    const findings = strat.evaluate({
      intent: intent("add rate limiting"),
      changeSet: changeSet([changed("Database.query", 20, { changeType: "added" })]),
      radius: emptyRadius,
    });
    expect(findings).toEqual([]);
  });
});

describe("DependentsThresholdStrategy", () => {
  it("flags wide-reaching changes regardless of intent", () => {
    const findings = new DependentsThresholdStrategy({ threshold: 8 }).evaluate({
      intent: null,
      changeSet: changeSet([changed("Config.load", 12), changed("tiny.helper", 2)]),
      radius: emptyRadius,
    });
    expect(findings.map((f) => f.symbol.qualifiedName)).toEqual(["Config.load"]);
  });

  it("calls out signature changes specifically", () => {
    const findings = new DependentsThresholdStrategy({ threshold: 5 }).evaluate({
      intent: null,
      changeSet: changeSet([
        changed("Database.query", 9, {
          changeType: "signature_changed",
          oldSignature: "query(sql)",
          newSignature: "query(sql, opts)",
        }),
      ]),
      radius: emptyRadius,
    });
    expect(findings[0]?.reason).toMatch(/run tests first/);
  });
});

describe("CompositeStrategy / defaultScopeCreepStrategy", () => {
  it("merges findings for the same symbol and keeps the higher severity", () => {
    const detector = defaultScopeCreepStrategy();
    const findings = detector.evaluate({
      intent: intent("add rate limiting to the redirect endpoint"),
      changeSet: changeSet([
        changed("Database.query", 16, {
          changeType: "signature_changed",
          oldSignature: "query(sql)",
          newSignature: "query(sql, opts)",
        }),
      ]),
      radius: emptyRadius,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.strategy).toContain("keyword-overlap");
    expect(findings[0]?.strategy).toContain("dependents-threshold");
    expect(findings[0]?.severity).toBe("high"); // 16 dependents
    expect(findings[0]?.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("sorts findings by severity then dependents", () => {
    const detector = new CompositeStrategy([new DependentsThresholdStrategy({ threshold: 3 })]);
    const findings = detector.evaluate({
      intent: null,
      changeSet: changeSet([changed("a.small", 4), changed("b.huge", 30), changed("c.mid", 8)]),
      radius: emptyRadius,
    });
    expect(findings.map((f) => f.symbol.qualifiedName)).toEqual(["b.huge", "c.mid", "a.small"]);
  });
});
