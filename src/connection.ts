
import { some, Dict } from './util';
import { StoreStructure } from './structure';
import { IndexableRegistry } from './indexable';
import { Store, StoreBroker } from './store';
import { Storable, StorableRegistry } from './storable';
import { JineBlockedError, JineInternalError, mapError } from './errors';
import { Transaction, TransactionMode, uglifyTransactionMode } from './transaction';

export interface Connection {

  /**
   * Create a new transaction and run some code with it, automatically committing
   * if the code completes or aborting if it fails.
   *
   * @param callback The code to run
   * @typeparam R the type of the callback result
   * @returns The result of the callback
   */
  transact<R>(stores: Array<string | Store<Storable>>, mode: TransactionMode, callback: (tx: Transaction) => Promise<R>): Promise<R>;

}

/**
 * A connection to a database.
 */
export class ConnectionActual<$$ = {}> implements Connection {

  /**
   * The Connection shorthand object.
   * Used for doing one-off database operations.
   *
   * An operation such as
   * ```plaintext
   * await conn.$.my_store.add(my_item)
   * ```
   * will automatically open start a [[Transaction]], run the `.add` operation,
   * then close the transaction.
   */
  $: $$;

  _idb_conn: IDBDatabase;
  _substructures: Dict<StoreStructure>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    idb_conn: IDBDatabase;
    substructures: Dict<StoreStructure>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this._idb_conn = args.idb_conn;
    this._substructures = args.substructures;
    this._storables = args.storables;
    this._indexables = args.indexables;

    const self = this;
    this.$ = <$$> new Proxy({}, {
      get(_target: {}, prop: string | number | symbol) {
        if (typeof prop === 'string') {
          const store_name = prop;
          // vvv Mimic missing key returning undefined
          if (!(store_name in self._substructures)) return undefined;
          const aut_store = new StoreBroker({
            name: store_name,
            conn: self,
            structure: some(self._substructures[store_name]),
            storables: self._storables,
            indexables: self._indexables,
          });
          return aut_store;
        }
      }
    });
  }

  /**
   * Create a new transaction on the given stores with the given mode.
   *
   * @param stores The stores that the transaction wants access to.
   * @param mode The transaction mode.
   * @returns A new transaction
   */
  newTransaction(stores: Array<string | Store<any>>, mode: TransactionMode): Transaction<$$> {
    const store_names = stores.map(s => typeof s === 'string' ? s : s.name);
    return new Transaction<$$>({
      idb_tx: this._idb_conn.transaction(store_names, uglifyTransactionMode(mode)),
      genuine: true,
      substructures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritdoc */
  async transact<R>(
    stores: Array<string | Store<any>>,
    mode: TransactionMode,
    callback: (tx: Transaction<$$>) => Promise<R>,
  ): Promise<R> {
    const tx = this.newTransaction(stores, mode);
    return await tx.wrap(async tx => await callback(tx));
  }

  /**
   * Close the connection to the database.
   */
  close(): void {
    this._idb_conn.close();
  }

  /**
   * Run some code with this connection and then close it afterwards.
   *
   * @param callback The code to run
   * @typeParam the type of the callback result
   * @returns The result of the callback
   */
  async wrap<R>(callback: (conn: this) => Promise<R>): Promise<R> {
    try {
      return await callback(this);
    } finally {
      this.close();
    }
  }

}

/**
 * A [[Connection]] not bound to one lifespan.
 *
 * A [[ConnectionBroker]] will actually open a *new* connection on each operation.
 * Compare this to [[ConnectionActual]], which has a temporal aspect.
 */
export class ConnectionBroker implements Connection {

  _db_name: string;
  _substructures: Dict<StoreStructure>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    db_name: string;
    substructures: Dict<StoreStructure>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this._db_name = args.db_name;
    this._substructures = args.substructures;
    this._storables = args.storables;
    this._indexables = args.indexables;
  }

  _newIdbConn(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const db_name = this._db_name;
      const req = indexedDB.open(db_name);
      // vvv Since we're opening without a version, no upgradeneeded should fire
      req.onupgradeneeded = _event => reject(new JineInternalError());
      req.onblocked = _event => reject(new JineBlockedError());
      req.onerror = _event => reject(mapError(req.error));
      req.onsuccess = _event => resolve(req.result);
    });
  }

  async _newConnectionActual(): Promise<ConnectionActual> {
    const idb_conn = await this._newIdbConn();
    return new ConnectionActual({
      idb_conn: idb_conn,
      substructures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritdoc */
  async transact<T>(
    stores: Array<string | Store<any>>,
    mode: TransactionMode,
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const conn = await this._newConnectionActual();
    const result = await conn.transact(stores, mode, callback);
    conn.close();
    return result;
  }

}
