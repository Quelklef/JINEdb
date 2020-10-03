
import { Dict } from './util';

/** Superclass for all jine-related errors */
export class JineError extends Error {
  constructor(message?: string) {
    super(message === undefined ? '' : '[Jine] ' + message);
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
export class JineNoSuchStoreError extends JineError {
  constructor(args: { storeName: string } | { oneOfStoreNames: Array<string> }) {
    const oneOfStoreNames = 'storeName' in args ? [args.storeName] : args.oneOfStoreNames;
    if (oneOfStoreNames.length === 1)
      super(`I was asked to operate on an store called '${oneOfStoreNames[0]}', but I could not find one.`);
    else
      super(`I was asked to operate on the stores '${oneOfStoreNames.join(', ')}', but I was unable to find at least one.`);
  }
}

/** Thrown when you try and access an index that doesn't exist */
export class JineNoSuchIndexError extends JineError {
  constructor(args: { indexName: string }) {
    super(`I was asked to operate on an index called '${args.indexName}', but I could not find one.`);
  }
}


// === JINE-ONLY ERRORS === //

/** Thrown when unable to encode a value to put it into the database */
export class JineEncodingError extends JineError { }

/** Thrown when unable to decode a value to take it out of the database */
export class JineDecodingError extends JineError { }

/** Thrown when an attempt to open a database is blocked. */
export class JineBlockedError extends JineError { }

/** Thrown when attemping to do an operation on a transaction of the wrong mode */
export class JineTransactionModeError extends JineError {
  constructor(args: { operationName?: string; expectedMode: string; actualMode: string }) {
    super(`I was trying to perform ${args.operationName ?? 'an operation'} on a transaction, but was unable to. The operation demands that the transaction be in '${args.expectedMode}' mode or higher, but it was only in '${args.actualMode}' mode.`);
  }
}

/** Jine has a bug! */
export class JineInternalError extends JineError {
  constructor(issue?: string) {
    super(
      `Encountered an internal error. This likely isn't your fault! Would you mind submitting a bug report?`
      + issue === undefined ? '' : `Error message: ${issue}`
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

