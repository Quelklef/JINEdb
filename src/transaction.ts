
import { Storable } from './storable';
import { some, Dict } from './util';
import { Store } from './store';
import { DatabaseSchema, StoreSchema } from './schema';

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

export type Transaction<$$> = TransactionImpl & $$;

export function newTransaction<$$>(idb_tx: IDBTransaction, db_schema: DatabaseSchema): Transaction<$$> {
  const tx = new TransactionImpl(idb_tx, db_schema);
  return tx as TransactionImpl & $$;
}

class TransactionImpl {

  readonly db_schema: DatabaseSchema;
  readonly stores: Dict<string, Store<Storable>>;
  readonly id: number;
  state: 'active' | 'committed' | 'aborted';

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

    this.state = 'active';
    this._idb_tx.addEventListener('error', () => {
      this.state = 'aborted';
      this._cease();
    });

    if (this._idb_tx.mode !== 'versionchange') this._prolong();
  }

  _poke(): void {
    /* Prolong the transaction through the current tick. */
    const store_names = this._idb_tx.objectStoreNames;
    const some_store_name = store_names[0];
    const some_store = this._idb_tx.objectStore(some_store_name);
    const _req = some_store.openCursor();
  }

  private _prolong_id: number | undefined;

  // Keep track of how many ticks the transaction has been alive
  private _lifetime_length = 0;

  _prolong(): void {
    /* Prolong a transaction until ._cease() is called, but throw a warning in the console
    for each tick that it remains uncommitted. */
    // For some reason, global 'setTimeout' has a weird type but 'window.setTimeout' doesn't.
    // However, want to avoid using the window object for testing.
    // Solution is as follows:
    const mySetTimeout = setTimeout as typeof window.setTimeout;
    this._poke();
    this._prolong_id = mySetTimeout(() => {
      this._lifetime_length++;
      //console.warn(`Transaction id '${this.id}' has been alive for ${this._lifetime_length} ticks.`);
      this._prolong();
    }, 0);
  }

  _cease(): void {
    clearTimeout(this._prolong_id);
  }

  commit(): void {
    /* Commit and end the transaction */
    // [2020-05-16] For some reason the types don't have IDBTransaction.commit(),
    // but it's in the online docs: https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/commit
    this._cease();
    (this._idb_tx as any).commit();
    this.state = 'committed';
  }

  abort(): void {
    this._cease();
    this._idb_tx.abort();
    this.state = 'aborted';
  }

}

