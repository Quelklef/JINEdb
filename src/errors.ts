
import { Dict } from './util';

/**
 * Parent for all jine-related errors
 */
export class JineError extends Error { }



// === SHADOWS OF IDB ERRORS === //

/**
 * From [MDN](https://developer.mozilla.org/en-US/docs/Web/API/IDBRequest/error):
 *
 * > If you abort the transaction, then all requests still in progress receive this error.
 */
export class JineAbortError extends JineError { }

/**
 * From [MDN](https://developer.mozilla.org/en-US/docs/Web/API/IDBRequest/error):
 *
 * > If you insert data that doesn't conform to a constraint. It's an exception type for creating stores and indexes. You get this error, for example, if you try to add a new key that already exists in the record.
 */
export class JineConstraintError extends JineError { }


/**
 * From [MDN](https://developer.mozilla.org/en-US/docs/Web/API/IDBRequest/error):
 *
 * > If you run out of disk quota and the user declined to grant you more space.
 */
export class JineQuotaError extends JineError { }

/**
 * From [MDN](https://developer.mozilla.org/en-US/docs/Web/API/IDBRequest/error):
 *
 * > If the operation failed for reasons unrelated to the database itself. A failure due to disk IO errors is such an example.
 */
export class JineUnknownError extends JineError { }

/**
 * From [MDN](https://developer.mozilla.org/en-US/docs/Web/API/IDBRequest/error):
 *
 * > If you try to open a database with a version lower than the one it already has.
 */
export class JineVersionError extends JineError { }



// === JINE-ONLY ERRORS === //

/**
 * Thrown when an attempt to open a database is blocked.
 */
export class JineBlockedError extends JineError { }

/**
 * Jine has a bug!
 */
export class JineInternalError extends JineError { }


// -- -- -- //

export function mapError(error: DOMException | null): JineError | DOMException | null {

  if (error === null)
    return error;

  const jine_error_types: Dict<string, typeof JineError> = {
    'AbortError'        : JineAbortError,
    'ConstraintError'   : JineConstraintError,
    'QuotaExceededError': JineQuotaError,
    'UnknownError'      : JineUnknownError,
    'VersionError'      : JineVersionError,
  }

  const jine_error_type = jine_error_types[error.name];

  if (jine_error_type === undefined)
    return error;

  const jine_error = new jine_error_type();

  // chrome et al
  if ((error as any).stack) jine_error.stack = (error as any).stack;

  return jine_error;

}
