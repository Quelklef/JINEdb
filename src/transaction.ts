
import { clone } from 'true-clone';

import { Dict } from './util';
import { Store } from './store';
import { AsyncCont } from './cont';
import { JineNoSuchStoreError } from './errors';
import { DatabaseSchema, StoreSchema } from './schema';

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

export function prettifyTransactionMode(idbTxMode: IDBTransactionMode): TransactionMode {
  return {
    readonly: 'r',
    readwrite: 'rw',
    versionchange: 'vc',
  }[idbTxMode] as TransactionMode;
}

export function uglifyTransactionMode(txMode: TransactionMode): IDBTransactionMode {
  return {
    r: 'readonly',
    rw: 'readwrite',
    vc: 'versionchange',
  }[txMode] as IDBTransactionMode;
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
  stores: Dict<Store<unknown>>;

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

  /**
   * Alias for [[Transaction.stores]], but with the user-defined `$$` type.
   *
   * Also see {@page Example}.
   */
  $: $$;

  _idbTx: IDBTransaction;
  _idbDb: IDBDatabase;
  _schema: DatabaseSchema;

  constructor(args: {
    idbTx: IDBTransaction;
    scope: Array<string>;
    schema: DatabaseSchema;
    genuine: boolean;
  }) {

    this.genuine = args.genuine;

    this._idbTx = args.idbTx;
    this._idbDb = this._idbTx.db;

    // Clone schema so that, if a migration occurs, then
    // changes are sandboxed in case of e.g. .abort()
    this._schema = clone(args.schema);

    this.stores = {};
    for (const storeName of args.scope) {
      let idbStore!: IDBObjectStore;
      try {
        idbStore = this._idbTx.objectStore(storeName);
      } catch (err) {
        if (err.name === 'NotFoundError')
          throw new JineNoSuchStoreError(`No store named '${storeName}' (no idb store found).`);
        throw err;
      }
      const store = new Store({
        idbStoreCont: AsyncCont.fromValue(idbStore),
        schemaCont: AsyncCont.fromValue(this._schema.store(storeName)),
      });
      this.stores[storeName] = store;
    }

    this.$ = <$$> new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const storeName = prop;
          // Don't get the store immediately, do it lazily.
          // This is to be consistent with the rest of the API, which is lazy.
          const getStore = (): IDBObjectStore => {
            try {
              return this._idbTx.objectStore(storeName);
            } catch (err) {
              if (err.name === 'NotFoundError')
                throw new JineNoSuchStoreError(`No store named '${storeName}' (no idb store found).`);
              throw err;
            }
          }

          return new Store({
            idbStoreCont: AsyncCont.fromProducer(getStore),
            schemaCont: AsyncCont.fromProducer(() => this._schema.store(storeName)),
          });
        }
      }
    });

    this.state = 'active';
    this._idbTx.addEventListener('abort', () => {
      this.state = 'aborted';
    });
    this._idbTx.addEventListener('error', () => {
      this.state = 'aborted';
    });
    this._idbTx.addEventListener('complete', () => {
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
      if (this.state === 'active') this.commit();
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
      if (this.state === 'active') this.commit();
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
  addStore<Item>(storeName: string): Store<Item> {

    this._idbDb.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });

    const storeSchema = new StoreSchema({
      name: storeName,
      indexes: { },
      codec: this._schema.codec,
    });

    const store = new Store<Item>({
      idbStoreCont: AsyncCont.fromValue(this._idbTx.objectStore(storeName)),
      schemaCont: AsyncCont.fromValue(storeSchema),
    });

    this._schema.addStore(storeName, storeSchema);
    this.stores[storeName] = store as any;

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
    this._idbDb.deleteObjectStore(name);
    this._schema.removeStore(name);
    delete this.stores[name];
  }

  /**
   * Commit a transaction, applying all staged changes to the database.
   */
  commit(): void {
    /* Commit and end the transaction */
    // [2020-05-16] For some reason the types don't have IDBTransaction.commit(),
    // but it's in the online docs: https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/commit
    (this._idbTx as any).commit();
    this.state = 'committed';
  }

  /**
   * Abort the transaction, cancelling all staged changes.
   */
  abort(): void {
    this._idbTx.abort();
    this.state = 'aborted';
  }

}

