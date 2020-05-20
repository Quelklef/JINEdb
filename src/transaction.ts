
import { Storable } from './storable';
import { some, Dict } from './util';
import { Store } from './store';
import { DatabaseSchema, StoreSchema } from './schema';

export type Transaction<$$> = TransactionImpl & $$;

export function newTransaction<$$>(idb_tx: IDBTransaction, db_schema: DatabaseSchema): Transaction<$$> {
  const tx = new TransactionImpl(idb_tx, db_schema);
  return tx as TransactionImpl & $$;
}

class TransactionImpl {

  readonly db_schema: DatabaseSchema;
  readonly stores: Dict<string, Store<Storable>>;
  readonly id: number;

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
    this.id = Math.floor(Math.random() * 1e6);

    this.stores = {};
    for (const store_name of db_schema.store_names) {
      const idb_store = this._idb_tx.objectStore(store_name);
      const store_schema = some(db_schema.store_schemas[store_name]);
      const store = Store.bound(store_schema, idb_store);
      this.stores[store_name] = store;
      (this as any)['$' + store_name] = store;
    }

    if (this._idb_tx.mode !== 'versionchange') this._prolong();
  }

  _poke(): void {
    /* Prolong the transaction through the current tick. */
    const store_names = this._idb_tx.objectStoreNames;
    const some_store_name = store_names[0];
    const _req = this._idb_tx.objectStore(some_store_name);
  }

  private _prolong_id: number | undefined;

  // Keep track of how many ticks the transaction has been alive
  private _lifetime_length = 0;

  _prolong(): void {
    /* Prolong a transaction until .commit() is called, but throw a warning in the console
    for each tick that it remains uncommitted. */
    // For some reason, global 'setTimeout' has a weird type but 'window.setTimeout' doesn't.
    // However, want to avoid using the window object for testing.
    // Solution is as follows:
    const mySetTimeout = setTimeout as typeof window.setTimeout;
    this._prolong_id = mySetTimeout(() => {
      this._lifetime_length++;
      console.warn(`Transaction id '${this.id}' has been alive for ${this._lifetime_length} ticks.`);
      this._prolong();
    }, 0);
  }

  commit(): void {
    /* Commit and end the transaction */
    // [2020-05-16] For some reason the types don't have IDBTransaction.commit(),
    // but it's in the online docs: https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/commit
    clearTimeout(this._prolong_id);
    (this._idb_tx as any).commit();
  }

}

