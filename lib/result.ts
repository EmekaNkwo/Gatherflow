/**
 * Small result type used by domain commands so refusals (an opted-out
 * visitor, a duplicate check-in, a missing record) are returned as data
 * rather than thrown, and the UI can surface them as plain messages.
 */

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string; code?: string };
export type Result<T> = Ok<T> | Err;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err(error: string, code?: string): Err {
  return { ok: false, error, code };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}

export function isErr<T>(result: Result<T>): result is Err {
  return !result.ok;
}

/** Returns the value or throws — only for call sites that already checked. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}
