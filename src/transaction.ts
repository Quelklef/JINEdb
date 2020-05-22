
import { Storable } from './storable';
import { some, Dict } from './util';
import { StoreSchema, BoundStore } from './store';

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

export class TransactionSchema {

  public store_schemas: Dict<string, StoreSchema<Storable>>;

  constructor(args: {
    store_schemas: Dict<string, StoreSchema<Storable>>;
  }) {
    this.store_schemas = args.store_schemas;
  }

  get store_names(): Set<string> {
    return new Set(Object.keys(this.store_schemas));
  }

}

export class Transaction<$$ = {}> {

  readonly tx_schema: TransactionSchema;
  readonly stores: Dict<string, BoundStore<Storable>>;
  readonly id: number;
  state: 'active' | 'committed' | 'aborted';

  readonly _idb_tx: IDBTransaction;
  readonly _idb_db: IDBDatabase;

  _addStore(store_name: string, schema: StoreSchema<Storable>): void {
    const idb_store = this._idb_db.createObjectStore(store_name, { keyPath: 'id', autoIncrement: true });
    const store = new BoundStore(schema, idb_store);
    this.tx_schema.store_schemas[store_name] = schema;
    this.stores[store_name] = store;
  }

  _removeStore(store_name: string): void {
    this._idb_db.deleteObjectStore(store_name);
    delete this.tx_schema.store_schemas[store_name];
    delete this.stores[store_name];
  }

  constructor(idb_tx: IDBTransaction, tx_schema: TransactionSchema) {
    this._idb_tx = idb_tx;
    this._idb_db = this._idb_tx.db;
    this.tx_schema = tx_schema;
    this.id = Math.floor(Math.random() * 1e6);

    this.stores = {};
    for (const store_name of tx_schema.store_names) {
      const idb_store = this._idb_tx.objectStore(store_name);
      const store_schema = some(tx_schema.store_schemas[store_name]);
      const store = new BoundStore(store_schema, idb_store);
      this.stores[store_name] = store;
    }

    this.state = 'active';
    this._idb_tx.addEventListener('error', () => {
      this.state = 'aborted';
      this._cease();
    });

    if (this._idb_tx.mode !== 'versionchange') this._prolong();
  }

  withShorthand(): $$ & Transaction<$$> {
    const has_shorthand = Object.keys(this).some(k => k.startsWith('$'));
    if (!has_shorthand) {
      for (const store_name of this.tx_schema.store_names) {
        (this as any)['$' + store_name] = this.stores[store_name];
      }
    }
    return this as any as $$ & Transaction<$$>;
  }

  wrapSynchronous<T>(callback: (tx: $$ & Transaction<$$>) => T): T {
    let result!: T;
    try {
      result = callback(this.withShorthand());
    } catch (ex) {
      if (this.state === 'active') this.abort();
      throw ex;
    }
    if (this.state === 'active') this.commit();
    return result;
  }

  async wrap<T>(callback: (tx: $$ & Transaction<$$>) => Promise<T>): Promise<T> {
    let result!: T;
    try {
      result = await callback(this.withShorthand());
    } catch (ex) {
      if (this.state === 'active') this.abort();
      throw ex;
    }
    if (this.state === 'active') this.commit();
    return result;
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
