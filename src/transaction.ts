
import { Storable } from './storable';
import { some, Dict } from './util';
import { StoreStructure, BoundStore } from './store';

/**
 * Modes that a transaction can take.
 *
 * `r` - Read only. Multiple read-only transactions can occur on the same stores at the same time.
 *
 * `rw` - Read and write. A read-write transaction will block accessed stores until it is complete.
 *
 * `vc` - Version change. A version change transaction will block an entire database from use until it is complete.
 */
export type TransactionMode = 'r' | 'rw' | 'vc';

export function prettifyTransactionMode(idb_tx_mode: IDBTransactionMode): TransactionMode {
  return {
    readonly: 'r',
    readwrite: 'rw',
    versionchange: 'vc',
  }[idb_tx_mode] as TransactionMode;
}

export function uglifyTransactionMode(tx_mode: TransactionMode): IDBTransactionMode {
  return {
    r: 'readonly',
    rw: 'readwrite',
    vc: 'versionchange',
  }[tx_mode] as IDBTransactionMode;
}

/**
 * Represents the structure of a transaction
 */
export class TransactionStructure {

  /**
   * The structure of the stores on the database that this transaction is bound to
   */
  store_structures: Dict<string, StoreStructure<Storable>>;

  constructor(args: {
    store_structures: Dict<string, StoreStructure<Storable>>;
  }) {
    this.store_structures = args.store_structures;
  }

  /**
   * The names of the object stores of the database this transaction is bound to.
   * Equivalent to `Object.keys(this.store_structures)`.
   * @returns The store names
   */
  get store_names(): Set<string> {
    return new Set(Object.keys(this.store_structures));
  }

}

/**
 * A transaction with a particular database.
 */
export class Transaction<$$ = {}> {

  /**
   * Structure of the transaction
   */
  readonly structure: TransactionStructure;

  /**
   * The object stores that the transaction has access to.
   */
  readonly stores: Dict<string, BoundStore<Storable>>;

  /**
   * Current transaction state.
   *
   * `active` - In progress.
   *
   * `committed` - Successfully complete.
   *
   * `aborted` - Unsuccessful.
   */
  state: 'active' | 'committed' | 'aborted';

  readonly _idb_tx: IDBTransaction;
  readonly _idb_db: IDBDatabase;

  constructor(idb_tx: IDBTransaction, structure: TransactionStructure) {
    this._idb_tx = idb_tx;
    this._idb_db = this._idb_tx.db;
    this.structure = structure;

    this.stores = {};
    for (const store_name of structure.store_names) {
      const idb_store = this._idb_tx.objectStore(store_name);
      const store_structure = some(structure.store_structures[store_name]);
      const store = new BoundStore(store_structure, idb_store);
      this.stores[store_name] = store;
    }

    this.state = 'active';
    this._idb_tx.addEventListener('abort', () => {
      this.state = 'aborted';
    });
    this._idb_tx.addEventListener('error', () => {
      this.state = 'aborted';
    });
    this._idb_tx.addEventListener('complete', () => {
      this.state = 'committed';
    });
  }

  _withShorthand(): $$ & this {
    for (const store_name of this.structure.store_names) {
      (this as any)['$' + store_name] = some(this.stores[store_name])._withShorthand();
    }
    const $$this = this as any as $$ & this;
    this._withShorthand = () => $$this;
    return $$this;
  }

  /**
   * Like {@link Transaction.wrap}, but synchronous.
   */
  wrapSynchronous<T>(callback: (tx: $$ & Transaction<$$>) => T): T {
    let result!: T;
    try {
      result = callback(this._withShorthand());
    } catch (ex) {
      if (this.state === 'active') this.abort();
      throw ex;
    }
    if (this.state === 'active') this.commit();
    return result;
  }

  /**
   * Run some code with the transaction.
   * If the code successfully completes, commit the transaction.
   * If the code calls `.abort()` or throws an exception, abort the transaction.
   * @param callback The code to run
   * @typeParam T The return type of the callback
   * @returns The return value of the callback
   */
  async wrap<T>(callback: (tx: $$ & Transaction<$$>) => Promise<T>): Promise<T> {
    let result!: T;
    try {
      result = await callback(this._withShorthand());
    } catch (ex) {
      if (this.state === 'active') this.abort();
      throw ex;
    }
    if (this.state === 'active') this.commit();
    return result;
  }

  /**
   * Commit a transaction, applying all staged changes to the database.
   */
  commit(): void {
    /* Commit and end the transaction */
    // [2020-05-16] For some reason the types don't have IDBTransaction.commit(),
    // but it's in the online docs: https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/commit
    (this._idb_tx as any).commit();
    this.state = 'committed';
  }

  /**
   * Abort the transaction, cancelling all staged changes.
   */
  abort(): void {
    this._idb_tx.abort();
    this.state = 'aborted';
  }

}
