
import { Dict } from './util';

/** Superclass for all jine-related errors */
export class JineError extends Error {
  constructor(message = '') {
    super(message ? '[Jine] ' + message : '');
  }
}


// === SHADOWS OF IDB ERRORS === //

/** Thrown when a transaction is aborted. */
export class JineAbortError extends JineError { }

/** Thrown when trying to insert data that would invalidate a database constraint, such as causing a unique index to have duplicate values. */
export class JineConstraintError extends JineError { }


/** Thrown when the user declines giving more disk space. */
export class JineQuotaError extends JineError { }

/** Thrown when IndexedDB throws an 'UnknownError'. */
export class JineUnknownError extends JineError { }

/** Thrown when opening a database with a version number lower than its current version */
export class JineVersionError extends JineError { }

/** Thrown when you try and access an store that doesn't exist */
export class JineNoSuchStoreError extends JineError { }

/** Thrown when you try and access an index that doesn't exist */
export class JineNoSuchIndexError extends JineError { }



// === JINE-ONLY ERRORS === //

/** Thrown when there is an ecoding or decoding issue */
export class JineCodecError extends JineError { }

/** Thrown when unable to encode a value to put it into the database */
export class JineEncodingError extends JineCodecError { }

/** Thrown when unable to decode a value to take it out of the database */
export class JineDecodingError extends JineCodecError { }

/** Thrown when an attempt to open a database is blocked. */
export class JineBlockedError extends JineError { }

/** Thrown when attemping to do an operation on a transaction of the wrong mode */
export class JineTransactionModeError extends JineError {
  constructor(operationName: string, expectedMode: string, actualMode: string) {
    super(`Cannot call ${operationName} on a '${actualMode}' transaction, only a '${expectedMode}' one.`);
  }
}

/** Jine has a bug! */
export class JineInternalError extends JineError {
  constructor(msg = "") {
    super(
      `Encountered an internal error. This likely isn't your fault! Would you mind submitting a bug report?`
      + msg ? `Error message: ${msg}` : ''
    );
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

