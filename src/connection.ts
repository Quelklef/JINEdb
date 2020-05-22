
import { some } from './util';
import { DatabaseSchema } from './database';
import { AutonomousIndex } from './index';
import { Store, AutonomousStore } from './store';
import { Transaction, TransactionMode, uglifyTransactionMode } from './transaction';

export interface Connection {

  readonly schema: DatabaseSchema;

  // TODO: will anything break if we implement
  //       getVersion() as `return this.schema.version`?
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

export class BoundConnection<$$ = {}> implements Connection {

  readonly schema: DatabaseSchema;

  readonly _idb_conn: IDBDatabase;

  constructor(
    schema: DatabaseSchema,
    idb_conn: IDBDatabase,
  ) {
    this.schema = schema;
    this._idb_conn = idb_conn;
  }

  getVersion(): Promise<number> {
    return Promise.resolve(this._idb_conn.version);
  }

  withShorthand(): $$ & BoundConnection<$$> {
    for (const store_name of this.schema.store_names) {
      const store_schema = some(this.schema.store_schemas[store_name]);
      const aut_store = new AutonomousStore(store_schema, this);
      (this as any)['$' + store_name] = aut_store;

      for (const index_name of store_schema.index_names) {
        const index_schema = some(store_schema.index_schemas[index_name]);
        const aut_index = new AutonomousIndex(index_schema, aut_store);
        (aut_store as any)['$' + index_name] = aut_index;
      }
    }

    return this as any as $$ & BoundConnection<$$>;
  }

  async _transact<T>(
    store_names: Array<string>,
    mode: TransactionMode,
    callback: (tx: $$ & Transaction<$$>) => Promise<T>,
  ): Promise<T> {
    const idb_conn = await this._idb_conn;
    const idb_tx = idb_conn.transaction(store_names, uglifyTransactionMode(mode));
    return await new Transaction<$$>(idb_tx, this.schema).wrap(async tx => await callback(tx));
  }

  async transact<T>(
    stores: Array<Store<any>>,
    mode: TransactionMode,
    callback: (tx: $$ & Transaction<$$>) => Promise<T>,
  ): Promise<T> {
    const store_names = stores.map(store => store.schema.name);
    return await this._transact(store_names, mode, callback);
  }

  close(): void {
    this._idb_conn.close();
  }

  async wrap<T>(callback: (me: Connection) => Promise<T>): Promise<T> {
    const result = await callback(this);
    this.close();
    return result;
  }

}

export class AutonomousConnection implements Connection {

  readonly schema: DatabaseSchema;

  constructor(schema: DatabaseSchema) {
    this.schema = schema;
  }

  _new_idb_conn(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const db_name = this.schema.name;
      const req = indexedDB.open(db_name);
      req.onupgradeneeded = _event => reject(Error('upgrade needed'));
      req.onsuccess = _event => resolve(req.result);
      req.onerror = _event => reject(req.error);
    });
  }

  async _new_bound_conn(): Promise<BoundConnection> {
    const idb_conn = await this._new_idb_conn();
    return new BoundConnection(this.schema, idb_conn);
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
