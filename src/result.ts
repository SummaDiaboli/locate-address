export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T, E = never>(value: T): Result<T, E> => ({ ok: true, value });

export const err = <E, T = never>(error: E): Result<T, E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } =>
  result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is { readonly ok: false; readonly error: E } =>
  !result.ok;

export const map =
  <T, U, E>(fn: (value: T) => U) =>
  (result: Result<T, E>): Result<U, E> =>
    isOk(result) ? ok(fn(result.value)) : err(result.error);

export const mapErr =
  <T, E, F>(fn: (error: E) => F) =>
  (result: Result<T, E>): Result<T, F> =>
    isErr(result) ? err(fn(result.error)) : ok(result.value);

export const flatMap =
  <T, U, E, F>(fn: (value: T) => Result<U, F>) =>
  (result: Result<T, E>): Result<U, E | F> =>
    isOk(result) ? fn(result.value) : err(result.error);

export const unwrapOr =
  <T>(fallback: T) =>
  <E>(result: Result<T, E>): T =>
    isOk(result) ? result.value : fallback;
