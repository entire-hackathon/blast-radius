/**
 * The full `AnalysisReport` as pretty JSON — the surface an agent consumes.
 */
import type { AnalysisReport } from "../../domain/model.js";
import type { Renderer, RenderedReport } from "../../ports/renderer.js";

export class JsonRenderer implements Renderer {
  readonly format = "json" as const;

  render(report: AnalysisReport): RenderedReport {
    return {
      format: "json",
      contentType: "application/json",
      body: JSON.stringify(report, null, 2),
      marker: undefined,
    };
  }
}
