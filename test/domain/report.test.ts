import { describe, expect, it } from "vitest";
import { analysisReportSchema } from "../../src/domain/model.js";
import { sampleReport } from "../helpers/sample.js";

describe("AnalysisReportBuilder", () => {
  it("produces a report that satisfies the public schema", () => {
    const report = sampleReport();
    expect(() => analysisReportSchema.parse(report)).not.toThrow();
  });

  it("derives change summary from the change set", () => {
    const report = sampleReport();
    expect(report.changeSummary.symbolCount).toBe(2);
    expect(report.changeSummary.fileCount).toBe(3);
    expect(report.changeSummary.widestDependents).toBe(16);
  });

  it("carries a null intent through when none was found", () => {
    const report = sampleReport({ intent: null });
    expect(report.intent).toBeNull();
  });
});
