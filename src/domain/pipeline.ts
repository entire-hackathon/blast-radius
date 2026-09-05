/**
 * A minimal railway-oriented pipeline.
 *
 * A `Stage` maps one value to a `Result` of the next. `chain` threads a value
 * through a list of stages, stopping at the first `Err`. Stages may be sync or
 * async. The `review` use-case composes the real analysis from these; keeping
 * the combinator tiny (rather than a general DAG engine) is deliberate — the
 * fan-out after the blast-radius step is spelled out explicitly in the use-case
 * where it is easy to read.
 */
import type { Result } from "./errors.js";
import { ok } from "./errors.js";

export type Stage<In, Out> = (input: In) => Result<Out> | Promise<Result<Out>>;

/** Run `stages` left to right, feeding each output into the next. */
export async function chain<A, B>(input: A, s1: Stage<A, B>): Promise<Result<B>>;
export async function chain<A, B, C>(
  input: A,
  s1: Stage<A, B>,
  s2: Stage<B, C>,
): Promise<Result<C>>;
export async function chain<A, B, C, D>(
  input: A,
  s1: Stage<A, B>,
  s2: Stage<B, C>,
  s3: Stage<C, D>,
): Promise<Result<D>>;
export async function chain(
  input: unknown,
  ...stages: Stage<unknown, unknown>[]
): Promise<Result<unknown>> {
  let current: Result<unknown> = ok(input);
  for (const stage of stages) {
    if (!current.ok) return current;
    current = await stage(current.value);
  }
  return current;
}

/**
 * Run independent pure computations over the same input and hand every result
 * to `combine`. Used for the scope-check / test-selection / summary fan-out,
 * which never fail (they are pure) so they return plain values, not Results.
 */
export function fanOut<In, A, B, C, Out>(
  input: In,
  branches: readonly [(i: In) => A, (i: In) => B, (i: In) => C],
  combine: (a: A, b: B, c: C) => Out,
): Out {
  const [fa, fb, fc] = branches;
  return combine(fa(input), fb(input), fc(input));
}
