import { describe, expect, it } from "vitest";
import {
  all,
  BlastRadiusError,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  settle,
  unwrapOr,
} from "../../src/domain/errors.js";

describe("Result", () => {
  it("ok / err construct and narrow", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err("x"))).toBe(true);
  });

  it("map only transforms the ok branch", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    const e = err(new BlastRadiusError("GIT_ERROR", "boom"));
    expect(map(e, (n: number) => n * 3)).toBe(e);
  });

  it("mapErr only transforms the err branch", () => {
    expect(mapErr(ok(2), () => "nope")).toEqual(ok(2));
    expect(mapErr(err("a"), (s) => s + "b")).toEqual(err("ab"));
  });

  it("unwrapOr returns the fallback on err", () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err("e"), 0)).toBe(0);
  });

  it("all short-circuits on the first err", () => {
    expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    expect(all([ok(1), err("bad"), ok(3)])).toEqual(err("bad"));
  });

  it("settle keeps every value and every error", () => {
    expect(settle([ok(1), err("a"), ok(2), err("b")])).toEqual({
      values: [1, 2],
      errors: ["a", "b"],
    });
  });
});

describe("BlastRadiusError", () => {
  it("factory helpers set the code", () => {
    expect(BlastRadiusError.binaryNotFound("entire-graph").code).toBe("BINARY_NOT_FOUND");
    expect(BlastRadiusError.graph("x").code).toBe("GRAPH_ERROR");
    expect(BlastRadiusError.git("x").code).toBe("GIT_ERROR");
    expect(BlastRadiusError.intentUnavailable("x").code).toBe("INTENT_UNAVAILABLE");
    expect(BlastRadiusError.sink("x").code).toBe("SINK_ERROR");
    expect(BlastRadiusError.config("x").code).toBe("CONFIG_ERROR");
  });

  it("carries an optional detail", () => {
    expect(BlastRadiusError.graph("msg", "stderr line").detail).toBe("stderr line");
  });
});
