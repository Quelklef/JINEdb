
import { Storable } from './storable';
import { some, Dict } from './util';
import { Store } from './store';
import { DatabaseSchema, StoreSchema } from './schema';

export class Transaction {

  readonly db_schema: DatabaseSchema;

  readonly stores: Dict<string, Store<Storable>>;

  readonly _idb_tx: IDBTransaction;
  readonly _idb_db: IDBDatabase;

  _addStore(store_name: string, schema: StoreSchema<Storable>): void {
    const idb_store = this._idb_db.createObjectStore(store_name, { keyPath: 'id', autoIncrement: true });
    const store = Store.bound(schema, idb_store);
    this.db_schema.store_schemas[store_name] = schema;
    this.stores[store_name] = store;
    (this as any)['$' + store_name] = store;
  }

  _removeStore(store_name: string): void {
    this._idb_db.deleteObjectStore(store_name);
    delete this.db_schema.store_schemas[store_name];
    delete this.stores[store_name];
    delete (this as any)['$' + store_name];
  }

  constructor(idb_tx: IDBTransaction, db_schema: DatabaseSchema) {
    this._idb_tx = idb_tx;
    this._idb_db = this._idb_tx.db;
    this.db_schema = db_schema;

    this.stores = {};
    for (const store_name of db_schema.store_names) {
      const idb_store = this._idb_tx.objectStore(store_name);
      const store_schema = some(db_schema.store_schemas[store_name]);
      const store = Store.bound(store_schema, idb_store);
      this.stores[store_name] = store;
      (this as any)['$' + store_name] = store;
    }
  }

  commit(): void {
    /* Commit and end the transaction */
    // [2020-05-16] For some reason the types don't have IDBTransaction.commit(),
    // but it's in the online docs: https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/commit
    (this._idb_tx as any).commit();
  }

}

