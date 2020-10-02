
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


/**
 * Thrown when you try and access an store that doesn't exist
 */
export class JineNoSuchStoreError extends JineError { }

/**
 * Thrown when you try and access an index that doesn't exist
 */
export class JineNoSuchIndexError extends JineError { }



// === JINE-ONLY ERRORS === //

/**
 * Thrown when an attempt to open a database is blocked.
 */
export class JineBlockedError extends JineError { }

/**
 * Jine has a bug!
 */
export class JineInternalError extends JineError {
  constructor() {
    super(`[Jine] Encountered an internal error. This likely isn't your fault! Would you mind submitting a bug report?`);
  }
}


// -- -- -- //

export function mapError(error: DOMException | null): JineError | DOMException | null {

  if (error === null)
    return error;

  const jineErrorTypes: Dict<typeof JineError> = {
    'AbortError'        : JineAbortError,
    'ConstraintError'   : JineConstraintError,
    'QuotaExceededError': JineQuotaError,
    'UnknownError'      : JineUnknownError,
    'VersionError'      : JineVersionError,
  }

  const jineErrorType = jineErrorTypes[error.name];

  if (jineErrorType === undefined)
    return error;

  const jineError = new jineErrorType(error.message);

  // chrome et al
  if ((error as any).stack)
    jineError.stack = (error as any).stack;

  return jineError;

}

