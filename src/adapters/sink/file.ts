import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlastRadiusError, err, ok, type Result } from "../../domain/errors.js";
import type { ReportSink } from "../../ports/report-sink.js";
import type { RenderedReport } from "../../ports/renderer.js";

export class FileSink implements ReportSink {
  readonly kind = "file";
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async publish(rendered: RenderedReport): Promise<Result<void>> {
    try {
      await mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
      await writeFile(this.filePath, rendered.body, "utf8");
      return ok(undefined);
    } catch (e) {
      return err(BlastRadiusError.sink(`could not write ${this.filePath}`, (e as Error).message));
    }
  }
}
