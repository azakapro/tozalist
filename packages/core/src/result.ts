/**
 * A minimal, dependency-free Result type.
 *
 * The core package is where deterministic domain logic will live, and that
 * logic must report failure as a value rather than by throwing, so callers in
 * the API and the worker can handle partial success consistently.
 *
 * Scope note (step 0.1): this is the error-handling primitive only. No
 * validation rules live here yet.
 */

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok
}

/** Applies `fn` to a success value; failures pass through untouched. */
export function map<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result
}

/** Chains a fallible step; the first failure short-circuits the rest. */
export function flatMap<T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result
}

/** Unwraps a success value, or returns `fallback` for a failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback
}
