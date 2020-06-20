
import { clone } from 'true-clone';

import { Store } from './store';
import { AsyncCont } from './cont';
import { some, Dict } from './util';
import { DatabaseSchema } from './schema';
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
 * A transaction on a particular database.
 *
 * Transactions are groups of related database operations.
 * Transactions are atomic: if an error occurs during a transaction, all operations will be cancelled.
 */
export class Transaction<$$ = {}> {

  /**
   * The object stores that the transaction has access to.
   *
   * For non-programmatic code, [[Transaction.$]] is nicer to use.
   */
  stores: Dict<Store<Storable>>;

  /**
   * A non-genuine transaction will not allow `.commit()` and will not
   * propagate staged changes to the databse.
   *
   * All transactions are genuine, except for those created by [[Database.upgrade]],
   * which may be genuine or ingenuine.
   *
   * Also see [[Database.upgrade]].
   */
  genuine: boolean;

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

  // TODO: I think these can be modified in non-versionchange transactions, which is not desirable
  /**
   * Registry of custom [[Storable]] objects.
   *
   * Also see {@page Serialization and Custom Types}.
   */
  get storables(): StorableRegistry {
    return this._schema.storables;
  }

  /**
   * Registry of custom [[Indexable]] types.
   *
   * Also see {@page Serialization and Custom Types}.
   */
  get indexables(): IndexableRegistry {
    return this._schema.indexables;
  }

  /**
   * Alias for [[Transaction.stores]], but with the user-defined `$$` type.
   *
   * Also see {@page Example}.
   */
  $: $$;

  _idb_tx: IDBTransaction;
  _idb_db: IDBDatabase;
  _schema: DatabaseSchema;

  constructor(args: {
    idb_tx: IDBTransaction;
    schema: DatabaseSchema;
    genuine: boolean;
  }) {

    this.genuine = args.genuine;

    this._idb_tx = args.idb_tx;
    this._idb_db = this._idb_tx.db;

    // Clone schema so that, if a migration occurs, then
    // changes are sandboxed in case of e.g. .abort()
    this._schema = clone(args.schema);

    this.stores = {};
    for (const store_name of Object.keys(this._schema.stores)) {
      const store = new Store({
        idb_store_k: AsyncCont.fromValue(this._idb_tx.objectStore(store_name)),
        schema_g: () => some(this._schema.stores[store_name]),
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

  /**
   *  [[Transaction.wrap]], but synchronous.
   */
 wrapSynchronous<R>(callback: (tx: Transaction<$$>) => R): R {
    try {
      return callback(this);
    } catch (ex) {
      if (this.state === 'active') this.abort();
      throw ex;
    } finally {
      if (this.state === 'active' && !this.genuine) this.abort();
      if (this.state === 'active' && this.genuine) this.commit();
    }
  }

  /**
   * Run some code with the transaction.
   * If the code successfully completes, commit the transaction.
   * If the code calls `.abort()` or throws an exception, abort the transaction.
   *
   * @param callback The code to run
   * @typeParam R The return type of the callback
   * @returns The return value of the callback
   */
  async wrap<R>(callback: (tx: Transaction<$$>) => Promise<R>): Promise<R> {
    try {
      return await callback(this);
    } catch (ex) {
      if (this.state === 'active') this.abort();
      throw ex;
    } finally {
      if (this.state === 'active' && !this.genuine) this.abort();
      if (this.state === 'active' && this.genuine) this.commit();
    }
  }

  /**
   * Add a store to the database.
   *
   * Only possible in a `versionchange` transaction, which is given by [[Database.upgrade]].
   *
   * @param name The name to give the new store
   * @returns The new store
   */
  addStore<Item extends Storable>(store_name: string): Store<Item> {

    this._idb_db.createObjectStore(store_name, { keyPath: 'id', autoIncrement: true });

    const store_schema = {
      name: store_name,
      indexes: { },
      storables: this._schema.storables,
      indexables: this._schema.indexables,
    };

    const store = new Store<Item>({
      idb_store_k: AsyncCont.fromValue(this._idb_tx.objectStore(store_name)),
      schema_g: () => store_schema,
    });

    this._schema.stores[store_name] = store_schema;
    this.stores[store_name] = store as any;

    return store;

  }

  /**
   * Remove a store from the index.
   *
   * Only possible in a `versionchange` transaction, which is given by [[Database.upgrade]].
   *
   * @param name The name of the store to remove
   */
  removeStore(name: string): void {
    this._idb_db.deleteObjectStore(name);
    delete this._schema.stores[name];
    delete this.stores[name];
  }

  /**
   * Commit a transaction, applying all staged changes to the database.
   */
  commit(): void {
    /* Commit and end the transaction */
    if (!this.genuine)
      throw Error('Cannot commit an ingeuine transaction.');
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

