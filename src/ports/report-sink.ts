/**
 * ReportSink port — where a rendered report goes.
 *   StdoutSink        — print it
 *   FileSink          — write it to a path
 *   GitHubCommentSink — upsert one PR comment (find its marker, edit or create)
 */
import type { Result } from "../domain/errors.js";
import type { RenderedReport } from "./renderer.js";

export interface ReportSink {
  readonly kind: string;
  publish(rendered: RenderedReport): Promise<Result<void>>;
}
