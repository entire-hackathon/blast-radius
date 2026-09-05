/**
 * Renderer port: an `AnalysisReport` -> a string in some format.
 * Pure. Adapters live in `src/adapters/render/`.
 */
import type { AnalysisReport } from "../domain/model.js";

export type RenderFormat = "markdown" | "json" | "sarif";

export interface RenderedReport {
  readonly format: RenderFormat;
  readonly contentType: string;
  readonly body: string;
  /** HTML-comment marker a sink uses to find and replace its own prior output. */
  readonly marker: string | undefined;
}

export interface Renderer {
  readonly format: RenderFormat;
  render(report: AnalysisReport): RenderedReport;
}

/** The marker every Blast Radius PR comment carries. */
export const COMMENT_MARKER = "<!-- blast-radius:v1 -->";
