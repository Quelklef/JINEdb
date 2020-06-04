
import { some, Dict } from './util';
import { IndexableRegistry } from './indexable';
import { StorableRegistry, Storable } from './storable';
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

  storables: StorableRegistry;
  indexables: IndexableRegistry;

  constructor(args: {
    store_structures: Dict<string, StoreStructure<Storable>>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.store_structures = args.store_structures;
    this.storables = args.storables;
    this.indexables = args.indexables;
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

  get storables(): StorableRegistry { return this.structure.storables; }
  get indexables(): IndexableRegistry { return this.structure.indexables; }

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

  readonly $: $$;

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
    this.$ = this.stores as $$;

    // TODO: what to do if blocked?
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

  // TODO: dry or not should probably (also?) be an attr of the tx
  /**
   * Like [[Transaction.wrap]], but synchronous.
   */
  wrapSynchronous<T>(callback: (tx: Transaction<$$>, dry: false) => T): T {
    try {
      return callback(this, false);
    } catch (ex) {
      if (this.state === 'active') this.abort();
      throw ex;
    } finally {
      if (this.state === 'active') this.commit();
    }
  }

  /**
   * Run some code with the transaction.
   * If the code successfully completes, commit the transaction.
   * If the code calls `.abort()` or throws an exception, abort the transaction.
   * @param callback The code to run
   * @typeParam T The return type of the callback
   * @returns The return value of the callback
   */
  async wrap<T>(callback: (tx: Transaction<$$>, dry: false) => Promise<T>): Promise<T> {
    try {
      return await callback(this, false);
    } catch (ex) {
      if (this.state === 'active') this.abort();
      throw ex;
    } finally {
      if (this.state === 'active') this.commit();
    }
  }

  /**
   * Like [[Transaction.wrap]], but the transaction cannot be committed and will
   * be aborted at the end of the callback
   */
  async dry_run<T>(callback: (tx: Transaction<$$>, dry: true) => Promise<T>): Promise<T> {
    const proxy = new Proxy(this, {
      get(target: any, prop: any): any {
        if (prop === 'commit') {
          return () => { throw Error('Cannot commit in a dry run!'); };
        } else {
          return target[prop];
        }
      }
    });

    try {
      return await callback(proxy._withShorthand(), true);
    } finally {
      this.abort();
    }
  }

  /**
   * Add a store.
   *
   * Store name must be preceeded with a `'$'`.
   *
   * @param $name `'$' +` store name
   */
  addStore<Item extends Storable>($name: string): BoundStore<Item> {
    const name = $name.slice(1);
    this._idb_db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
    const idb_store = this._idb_tx.objectStore(name);
    const store_structure = new StoreStructure({
      name: name,
      index_structures: {},
      storables: this.structure.storables,
      indexables: this.structure.indexables,
    });
    const store = new BoundStore<Item>(store_structure, idb_store);
    this.structure.store_structures[name] = store_structure as StoreStructure<Storable>;
    this.stores[name] = store as any as BoundStore<Storable>;
    (this as any)[$name] = store;
    return store;
  }

  /**
   * Remove a store
   *
   * Store name must be preceeded with a `'$'`.
   *
   * @param $name `'$' +` store name
   */
  removeStore($name: string): void {
    const name = $name.slice(1);
    this._idb_db.deleteObjectStore(name);
    delete this.structure.store_structures[name];
    delete this.stores[name];
    delete (this as any)[$name];
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

