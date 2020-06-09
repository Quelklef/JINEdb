
import { some, Dict } from './util';
import { IndexableRegistry } from './indexable';
import { Store, AutonomousStore } from './store';
import { Storable, StorableRegistry } from './storable';
import { StoreStructure } from './structure';
import { JineBlockedError, JineInternalError, mapError } from './errors';
import { Transaction, TransactionMode, uglifyTransactionMode } from './transaction';

/**
 * Generic interface for connections to databases
 */
export interface Connection {

  _transact<T>(store_names: Array<string>, mode: TransactionMode, callback: (tx: Transaction) => Promise<T>): Promise<T>;

  transact<T>(stores: Array<Store<Storable>>, mode: TransactionMode, callback: (tx: Transaction) => Promise<T>): Promise<T>;

}

/**
 * A connection bound to a database
 */
export class BoundConnection<$$ = {}> implements Connection {

  db_name: string;

  _idb_conn: IDBDatabase;

  _substructures: Dict<StoreStructure>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  $: $$;

  constructor(args: {
    db_name: string;
    idb_conn: IDBDatabase;
    substructures: Dict<StoreStructure>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.db_name = args.db_name;

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
          const aut_store = new AutonomousStore({
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

  async _newTransaction(store_names: Array<string>, mode: TransactionMode): Promise<Transaction<$$>> {
    return new Transaction<$$>({
      idb_tx: this._idb_conn.transaction(store_names, uglifyTransactionMode(mode)),
      substructures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /**
   * Create a new transaction on the given stores with the given mode.
   * @param stores The stores that the transaction wants access to.
   * @param mode The transaction mode.
   * @returns A new transaction
   */
  async newTransaction(stores: Array<Store<any>>, mode: TransactionMode): Promise<Transaction<$$>> {
    const store_names = stores.map(store => store.name);
    return await this._newTransaction(store_names, mode);
  }

  async _transact<T>(
    store_names: Array<string>,
    mode: TransactionMode,
    callback: (tx: Transaction<$$>) => Promise<T>,
  ): Promise<T> {
    const tx = await this._newTransaction(store_names, mode);
    return await tx.wrap(async tx => await callback(tx));
  }

  /**
   * Create a new transaction and run some code with it, automatically committing
   * if the code completes or aborting if it fails.
   * @param callback The code to run
   * @typeParam T the type of the callback result
   * @returns The result of the callback
   */
  async transact<T>(
    stores: Array<Store<any>>,
    mode: TransactionMode,
    callback: (tx: Transaction<$$>) => Promise<T>,
  ): Promise<T> {
    return (await this.newTransaction(stores, mode)).wrap(async tx => await callback(tx));
  }

  /**
   * Close the connection to the database.
   */
  close(): void {
    this._idb_conn.close();
  }

  /**
   * Run some code with this connection and then close it afterwards.
   * @param callback The code to run
   * @typeParam the type of the callback result
   * @returns The result of the callback
   */
  async wrap<T>(callback: (conn: this) => Promise<T>): Promise<T> {
    try {
      return await callback(this);
    } finally {
      this.close();
    }
  }

}

export class AutonomousConnection implements Connection {

  db_name: string;

  _substructures: Dict<StoreStructure>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    db_name: string;
    substructures: Dict<StoreStructure>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.db_name = args.db_name;
    this._substructures = args.substructures;
    this._storables = args.storables;
    this._indexables = args.indexables;
  }

  _new_idb_conn(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const db_name = this.db_name;
      const req = indexedDB.open(db_name);
      // since we're opening without a version, no upgradeneeded should fire
      req.onupgradeneeded = _event => reject(new JineInternalError());
      req.onblocked = _event => reject(new JineBlockedError());
      req.onerror = _event => reject(mapError(req.error));
      req.onsuccess = _event => resolve(req.result);
    });
  }

  async _new_bound_conn(): Promise<BoundConnection> {
    const idb_conn = await this._new_idb_conn();
    return new BoundConnection({
      db_name: this.db_name,
      idb_conn: idb_conn,
      substructures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  async _transact<T>(
    store_names: Array<string>,
    mode: TransactionMode,
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const conn = await this._new_bound_conn();
    const result = await conn._transact(store_names, mode, callback);
    conn.close();
    return result;
  }

  async transact<T>(
    stores: Array<Store<any>>,
    mode: TransactionMode,
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const conn = await this._new_bound_conn();
    const result = await conn.transact(stores, mode, callback);
    conn.close();
    return result;
  }

}
