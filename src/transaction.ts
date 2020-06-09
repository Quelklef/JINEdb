
import { clone } from 'true-clone';
import { some, Dict } from './util';
import { BoundStore } from './store';
import { StoreStructure } from './structure';
import { IndexableRegistry } from './indexable';
import { Storable, StorableRegistry } from './storable';

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
 * A transaction with a particular database.
 */
export class Transaction<$$ = {}> {

  _substructures: Dict<StoreStructure>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  get storables(): StorableRegistry { return this._storables; }
  get indexables(): IndexableRegistry { return this._indexables; }

  /**
   * The object stores that the transaction has access to.
   */
  stores: Dict<BoundStore<Storable>>;

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

  constructor(args: {
    idb_tx: IDBTransaction;
    substructures: Dict<StoreStructure>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this._idb_tx = args.idb_tx;
    this._idb_db = this._idb_tx.db;
    // Clone structure so that changes are sandboxed in case of e.g. .abort()
    this._substructures = clone(args.substructures);
    this._storables = clone(args.storables);
    this._indexables = clone(args.indexables);

    this.stores = {};
    for (const store_name of Object.keys(this._substructures)) {
      const idb_store = this._idb_tx.objectStore(store_name);
      const store = new BoundStore({
        idb_store: idb_store,
        structure: some(this._substructures[store_name]),
        storables: this._storables,
        indexables: this._indexables,
      });
      this.stores[store_name] = store;
    }
    this.$ = this.stores as $$;

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
   * @param name store name
   */
  addStore<Item extends Storable>(store_name: string): BoundStore<Item> {

    this._idb_db.createObjectStore(store_name, { keyPath: 'id', autoIncrement: true });

    const store_structure = {
      name: store_name,
      indexes: { },
    };

    const store = new BoundStore<Item>({
      idb_store: this._idb_tx.objectStore(store_name),
      structure: store_structure,
      storables: this._storables,
      indexables: this._indexables,
    });

    this._substructures[store_name] = store_structure;
    this.stores[store_name] = store as any as BoundStore<Storable>;

    return store;

  }

  /**
   * Remove a store
   *
   * @param name store name
   */
  removeStore(name: string): void {
    this._idb_db.deleteObjectStore(name);
    delete this._substructures[name];
    delete this.stores[name];
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

