
import { some } from './util';
import { DatabaseStructure } from './database';
import { Store, AutonomousStore } from './store';
import { Transaction, TransactionMode, uglifyTransactionMode } from './transaction';

/**
 * Generic interface for connections to databases
 */
export interface Connection {

  /**
   * Structure of the database
   */
  readonly structure: DatabaseStructure;

  // TODO: will anything break if we implement
  //       getVersion() as `return this.structure.version`?
  //       If so, is that a code smell?
  getVersion(): Promise<number>;

  _transact<T>(store_names: Array<string>, mode: TransactionMode, callback: (tx: Transaction) => Promise<T>): Promise<T>;

  // `stores` really has type Array<Store<? extends Storable>>, but TypeScript
  // doesn't support existential types at the moment :(
  // Apparently they can be emulated. This would be nice, as a massive amount
  // of this codebase has existential types hidden around it.
  // TODO: try emulating existential types.
  transact<T>(stores: Array<Store<any>>, mode: TransactionMode, callback: (tx: Transaction) => Promise<T>): Promise<T>;

}

/**
 * A connection bound to a database
 */
export class BoundConnection<$$ = {}> implements Connection {

  readonly structure: DatabaseStructure;

  readonly _idb_conn: IDBDatabase;

  constructor(
    structure: DatabaseStructure,
    idb_conn: IDBDatabase,
  ) {
    this.structure = structure;
    this._idb_conn = idb_conn;
  }

  getVersion(): Promise<number> {
    return Promise.resolve(this._idb_conn.version);
  }

  _withShorthand(): $$ & this {
    for (const store_name of this.structure.store_names) {
      const store_structure = some(this.structure.store_structures[store_name]);
      const aut_store = new AutonomousStore(store_structure, this);
      (this as any)['$' + store_name] = aut_store._withShorthand();
    }
    const $$this = this as any as $$ & this;
    this._withShorthand = () => $$this;
    return $$this;
  }

  async _newTransaction(store_names: Array<string>, mode: TransactionMode): Promise<$$ & Transaction<$$>> {
    const idb_conn = await this._idb_conn;
    const idb_tx = idb_conn.transaction(store_names, uglifyTransactionMode(mode));
    const tx = await new Transaction<$$>(idb_tx, this.structure)._withShorthand();
    return tx;
  }

  /**
   * Create a new transaction on the given stores with the given mode.
   * @param stores The stores that the transaction wants access to.
   * @param mode The transaction mode.
   * @returns A new transaction
   */
  async newTransaction(stores: Array<Store<any>>, mode: TransactionMode): Promise<$$ & Transaction<$$>> {
    const store_names = stores.map(store => store.structure.name);
    return await this._newTransaction(store_names, mode);
  }

  async _transact<T>(
    store_names: Array<string>,
    mode: TransactionMode,
    callback: (tx: $$ & Transaction<$$>) => Promise<T>,
  ): Promise<T> {
    return (await this._newTransaction(store_names, mode)).wrap(async tx => await callback(tx));
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
    callback: (tx: $$ & Transaction<$$>) => Promise<T>,
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
  async wrap<T>(callback: (me: Connection) => Promise<T>): Promise<T> {
    const result = await callback(this);
    this.close();
    return result;
  }

}

export class AutonomousConnection implements Connection {

  readonly structure: DatabaseStructure;

  constructor(structure: DatabaseStructure) {
    this.structure = structure;
  }

  _new_idb_conn(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const db_name = this.structure.name;
      const req = indexedDB.open(db_name);
      req.onupgradeneeded = _event => reject(Error('upgrade needed'));
      req.onsuccess = _event => resolve(req.result);
      req.onerror = _event => reject(req.error);
    });
  }

  async _new_bound_conn(): Promise<BoundConnection> {
    const idb_conn = await this._new_idb_conn();
    return new BoundConnection(this.structure, idb_conn);
  }

  async getVersion(): Promise<number> {
    const conn = await this._new_bound_conn();
    const result = await conn.getVersion();
    conn.close();
    return result;
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
