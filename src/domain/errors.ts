/**
 * Error model + a tiny Result type.
 *
 * Adapters do I/O and can fail in expected ways (binary missing, git rejects a
 * ref, GitHub is unreachable). Those are values, not exceptions: an adapter
 * returns `Result<T, BlastRadiusError>` and the caller decides. We still throw
 * for genuine programmer errors (a schema that can't parse our own fixtures).
 */

export type ErrorCode =
  | "BINARY_NOT_FOUND"
  | "GRAPH_ERROR"
  | "GIT_ERROR"
  | "INTENT_UNAVAILABLE"
  | "SINK_ERROR"
  | "CONFIG_ERROR"
  | "SCHEMA_ERROR";

export class BlastRadiusError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "BlastRadiusError";
    this.code = code;
    this.detail = detail;
  }

  static binaryNotFound(bin: string): BlastRadiusError {
    return new BlastRadiusError(
      "BINARY_NOT_FOUND",
      `\`${bin}\` was not found on PATH. Install entire-graph or pass --fixture <dir>.`,
    );
  }

  static graph(message: string, detail?: string): BlastRadiusError {
    return new BlastRadiusError("GRAPH_ERROR", message, detail);
  }

  static git(message: string, detail?: string): BlastRadiusError {
    return new BlastRadiusError("GIT_ERROR", message, detail);
  }

  static intentUnavailable(message: string): BlastRadiusError {
    return new BlastRadiusError("INTENT_UNAVAILABLE", message);
  }

  static sink(message: string, detail?: string): BlastRadiusError {
    return new BlastRadiusError("SINK_ERROR", message, detail);
  }

  static config(message: string): BlastRadiusError {
    return new BlastRadiusError("CONFIG_ERROR", message);
  }

  static schema(message: string, detail?: string): BlastRadiusError {
    return new BlastRadiusError("SCHEMA_ERROR", message, detail);
  }
}

/* --------------------------------------------------------------- Result --- */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = BlastRadiusError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

/** Collect an array of Results into a Result of an array (first error wins). */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const out: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}

/** Partition results, keeping every success and every failure. */
export function settle<T, E>(results: readonly Result<T, E>[]): { values: T[]; errors: E[] } {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return { values, errors };
}
