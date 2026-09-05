import { ok, type Result } from "../../domain/errors.js";
import type { ReportSink } from "../../ports/report-sink.js";
import type { RenderedReport } from "../../ports/renderer.js";

export class StdoutSink implements ReportSink {
  readonly kind = "stdout";
  private readonly write: (s: string) => void;

  constructor(write: (s: string) => void = (s) => process.stdout.write(s)) {
    this.write = write;
  }

  async publish(rendered: RenderedReport): Promise<Result<void>> {
    this.write(rendered.body.endsWith("\n") ? rendered.body : `${rendered.body}\n`);
    return ok(undefined);
  }
}
