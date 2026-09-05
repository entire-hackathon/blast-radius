import { describe, expect, it } from "vitest";
import { JsonRenderer } from "../../src/adapters/render/json.js";
import { MarkdownRenderer } from "../../src/adapters/render/markdown.js";
import { SarifRenderer } from "../../src/adapters/render/sarif.js";
import { analysisReportSchema } from "../../src/domain/model.js";
import { sampleReport } from "../helpers/sample.js";

describe("MarkdownRenderer", () => {
  it("renders the full comment (snapshot)", () => {
    const r = new MarkdownRenderer({
      repoBlobUrlBase: "https://github.com/acme/linkshrink/blob/def456",
      suiteTestCount: 40,
    }).render(sampleReport());
    expect(r.marker).toBe("<!-- blast-radius:v1 -->");
    expect(r.body).toMatchSnapshot();
  });

  it("headline names nodes, findings and tests", () => {
    const body = new MarkdownRenderer().render(sampleReport()).body;
    expect(body).toContain("**3 nodes** · 2 modules · 1 service · **1 scope finding** · **2 tests**");
  });

  it("degrades gracefully with no intent", () => {
    const body = new MarkdownRenderer().render(sampleReport({ intent: null })).body;
    expect(body).toContain("Intent** — none found");
    expect(body).not.toContain("Scope check — every change maps");
  });

  it("emits plain locators when no blob url base is given", () => {
    const body = new MarkdownRenderer().render(sampleReport()).body;
    expect(body).toContain("`src/db/database.ts:41`");
    expect(body).not.toContain("https://github.com");
  });
});

describe("JsonRenderer", () => {
  it("round-trips through the schema", () => {
    const body = new JsonRenderer().render(sampleReport()).body;
    expect(() => analysisReportSchema.parse(JSON.parse(body))).not.toThrow();
  });
});

describe("SarifRenderer", () => {
  it("emits SARIF 2.1.0 with one result per finding", () => {
    const body = new SarifRenderer().render(sampleReport()).body;
    const sarif = JSON.parse(body);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0].level).toBe("error");
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
      "src/db/database.ts",
    );
  });
});
