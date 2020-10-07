
import { clone } from 'true-clone';

import { Dict } from './util';
import { Store } from './store';
import { PACont } from './cont';
import { JineTransactionModeError } from './errors';
import { DatabaseSchema, StoreSchema } from './schema';
import { Codec, Storable, NativelyStorable } from './codec';

/**
 * Modes that a transaction can take.
 *
 * `r` - Read only. Multiple read-only transactions can occur on the same stores at the same time.
 *
 * `rw` - Read and write. A read-write transaction will block accessed stores until it is complete.
 *
 * `m` - Migration. A migration transaction will block an entire database from use until it is complete.
 */
export type TransactionMode = 'r' | 'rw' | 'm';

export function txModeLeq(a: TransactionMode, b: TransactionMode): boolean {
  const ranks = { r: 0, rw: 1, m: 2 };
  return ranks[a] <= ranks[b];
}

export function prettifyTxMode(idbTxMode: IDBTransactionMode): TransactionMode {
  return {
    readonly: 'r',
    readwrite: 'rw',
    versionchange: 'm',
  }[idbTxMode] as TransactionMode;
}

export function uglifyTxMode(txMode: TransactionMode): IDBTransactionMode {
  return {
    r: 'readonly',
    rw: 'readwrite',
    m: 'versionchange',
  }[txMode] as IDBTransactionMode;
}

/**
 * A database transaction.
 *
 * Transactions are groups of related database operations, such as adding,
 * removing, and qurying data. Transactions are atomic: if an error occurs
 * during a transaction, all operations will be cancelled.
 */
export class Transaction<$$ = unknown> {

  /**
   * The object stores that the transaction has access to.
   *
   * For non-programmatic code, [[Transaction.$]] is nicer to use.
   */
  public stores: Dict<Store<NativelyStorable>>;

  /** See {@page Versioning}. */
  public readonly genuine: boolean;

  /**
   * Current transaction state.
   *
   * `active` - In progress.
   *
   * `committed` - Successfully complete.
   *
   * `aborted` - Unsuccessful.
   */
  get state(): 'active' | 'committed' | 'aborted' {
    return this._state;
  }

  private _state: 'active' | 'committed' | 'aborted';

  /** Transaction mode */
  get mode(): TransactionMode {
    return prettifyTxMode(this._idbTx.mode);
  }

  /**
   * The transaction shorthand object.
   *
   * An operation such as
   * ```ts
   * await tx.$.myStore.add(myitem)
   * ```
   * Will add an item to the database store called `myStore`.
   *
   * Also see {@page Example}.
   */
  public readonly $: $$;

  private readonly _idbTx: IDBTransaction;
  private readonly _idbDb: IDBDatabase;
  private readonly _codec: Codec;

  // vv Public so that migrations can read the resulting schema
  public readonly _schema: DatabaseSchema;

  constructor(args: {
    idbTx: IDBTransaction;
    scope: Set<string>;
    schema: DatabaseSchema;
    genuine: boolean;
    codec: Codec;
  }) {

    this.genuine = args.genuine;

    this._idbTx = args.idbTx;
    this._idbDb = this._idbTx.db;
    this._codec = args.codec;

    // vv Cloned so that changes during migrations are sandboxed in case of .abort()
    this._schema = clone(args.schema);

    const $: Record<string, Store<NativelyStorable>> = new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const storeName = prop;
          const store = new Store({
            parentIdbTxCont: this._toCont(),
            // vv Use a producer to keep things lazy. Defers errors to the invokation code.
            schemaCont: PACont.fromProducer(() => this._schema.store(storeName)),
            codec: this._codec,
          });
          return store;
        }
      }
    });
    this.$ = $ as any as $$;

    this.stores = {};
    for (const storeName of args.scope)
      this.stores[storeName] = $[storeName];

    this._state = 'active';
    this._idbTx.addEventListener('abort', () => {
      this._state = 'aborted';
    });
    this._idbTx.addEventListener('error', () => {
      this._state = 'aborted';
    });
    this._idbTx.addEventListener('complete', () => {
      this._state = 'committed';
    });

  }

  private _toCont(): PACont<IDBTransaction, TransactionMode> {
    return PACont.fromProducer((txMode: TransactionMode) => {
      if (!txModeLeq(txMode, this.mode))
        throw new JineTransactionModeError({ expectedMode: txMode, actualMode: this.mode });
      return this._idbTx;
    });
  }

  /** Like [[Transaction.wrap]] but synchronous. */
 wrapSynchronous<R>(callback: (tx: Transaction<$$>) => R): R {
    try {
      return callback(this);
    } catch (ex) {
      if (this._state === 'active') this.abort();
      throw ex;
    } finally {
      if (this._state === 'active') this.commit();
    }
  }

  /**
   * Run some code with the transaction.
   * If the code successfully completes, commit the transaction.
   * If the code calls `.abort()` or throws an exception, abort the transaction.
   */
  async wrap<R>(callback: (tx: Transaction<$$>) => Promise<R>): Promise<R> {
    try {
      return await callback(this);
    } catch (ex) {
      if (this._state === 'active') this.abort();
      throw ex;
    } finally {
      if (this._state === 'active') this.commit();
    }
  }

  /**
   * Add a store to the database.
   *
   * Only possible a migration; see {@page Versioning}.
   */
  addStore<Item extends Storable>(storeName: string): Store<Item> {

    if (this.mode !== 'm')
      throw new JineTransactionModeError({ operationName: 'Transaction#addStore', expectedMode: 'm', actualMode: this.mode });

    this._idbDb.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });

    const storeSchema = new StoreSchema({
      name: storeName,
      indexes: { },
    });

    const store = new Store<Item>({
      parentIdbTxCont: this._toCont(),
      schemaCont: PACont.fromValue(storeSchema),
      codec: this._codec,
    });

    this._schema.addStore(storeName, storeSchema);
    this.stores[storeName] = store as any;

    return store;

  }

  /**
   * Remove a store from the index.
   *
   * Only possible in a migration; see {@page Versioning}.
   */
  removeStore(name: string): void {

    if (this.mode !== 'm')
      throw new JineTransactionModeError({ operationName: 'Transaction#removeStore', expectedMode: 'm', actualMode: this.mode });

    this._idbDb.deleteObjectStore(name);
    this._schema.removeStore(name);
    delete this.stores[name];

  }

  /** Commit a transaction, applying all staged changes to the database. */
  commit(): void {
    /* Commit and end the transaction */
    // [2020-05-16] For some reason the types don't have IDBTransaction.commit(),
    // but it's in the online docs: https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/commit
    (this._idbTx as any).commit();
    this._state = 'committed';
  }

  /** Abort the transaction, cancelling all staged changes. */
  abort(): void {
    this._idbTx.abort();
    this._state = 'aborted';
  }

}

