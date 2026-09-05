import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileSink } from "../../src/adapters/sink/file.js";
import { StdoutSink } from "../../src/adapters/sink/stdout.js";
import type { RenderedReport } from "../../src/ports/renderer.js";

const rendered: RenderedReport = {
  format: "markdown",
  contentType: "text/markdown",
  body: "# hello",
  marker: "<!-- blast-radius:v1 -->",
};

describe("StdoutSink", () => {
  it("writes the body with a trailing newline", async () => {
    let captured = "";
    const res = await new StdoutSink((s) => (captured += s)).publish(rendered);
    expect(res.ok).toBe(true);
    expect(captured).toBe("# hello\n");
  });
});

describe("FileSink", () => {
  it("writes the report to disk", async () => {
    const file = path.join(tmpdir(), `br-${Date.now()}.md`);
    const res = await new FileSink(file).publish(rendered);
    expect(res.ok).toBe(true);
    expect(await readFile(file, "utf8")).toBe("# hello");
  });
});
