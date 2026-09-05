import { describe, expect, it } from "vitest";
import { BlastRadiusError, err, ok } from "../../src/domain/errors.js";
import { chain, fanOut } from "../../src/domain/pipeline.js";

describe("chain", () => {
  it("threads a value through sync and async stages", async () => {
    const r = await chain(
      2,
      (n: number) => ok(n + 1),
      async (n: number) => ok(n * 10),
    );
    expect(r).toEqual(ok(30));
  });

  it("stops at the first err and skips later stages", async () => {
    let reached = false;
    const boom = BlastRadiusError.graph("stop");
    const r = await chain(
      1,
      () => err(boom),
      (n: number) => {
        reached = true;
        return ok(n);
      },
    );
    expect(r).toEqual(err(boom));
    expect(reached).toBe(false);
  });
});

describe("fanOut", () => {
  it("runs every branch on the same input and combines", () => {
    const out = fanOut(
      10,
      [(n) => n + 1, (n) => n * 2, (n) => `${n}`],
      (a, b, c) => ({ a, b, c }),
    );
    expect(out).toEqual({ a: 11, b: 20, c: "10" });
  });
});
