
import { Store } from './store';
import { AsyncCont } from './cont';
import { some, Dict } from './util';
import { StoreStructure } from './structure';
import { StorableRegistry } from './storable';
import { IndexableRegistry } from './indexable';
import { Transaction, TransactionMode, uglifyTransactionMode } from './transaction';


/**
 * A connection to a database.
 */
export class Connection<$$ = {}> {

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

  _idb_conn_k: AsyncCont<IDBDatabase>;
  _substructures: Dict<StoreStructure>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    idb_conn_k: AsyncCont<IDBDatabase>;
    substructures: Dict<StoreStructure>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this._idb_conn_k = args.idb_conn_k;
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
          // vvv TODO: code duplication; below is copy/pasted from database.ts
          const idb_store_k = self._idb_conn_k.map(idb_conn => {
            // TODO: how to tell what mode? cant hardcode readwrie
            const idb_tx = idb_conn.transaction([store_name], 'readwrite');
            const idb_store = idb_tx.objectStore(store_name);
            return idb_store;
          });
          const aut_store = new Store({
            idb_store_k: idb_store_k,
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
  newTransaction(stores: Array<string | Store<any>>, tx_mode: TransactionMode): AsyncCont<Transaction<$$>> {
    const store_names = stores.map(s => typeof s === 'string' ? s : s.name);
    const idb_tx_mode = uglifyTransactionMode(tx_mode)
    return this._idb_conn_k.map(idb_conn => {
      return new Transaction<$$>({
        idb_tx: idb_conn.transaction(store_names, idb_tx_mode),
        genuine: true,
        substructures: this._substructures,
        storables: this._storables,
        indexables: this._indexables,
      });
    });
  }

  /**
   * Create a new transaction and run some code with it, automatically committing
   * if the code completes or aborting if it fails.
   *
   * @param callback The code to run
   * @typeparam R the type of the callback result
   * @returns The result of the callback
   */
  async transact<R>(
    stores: Array<string | Store<any>>,
    mode: TransactionMode,
    callback: (tx: Transaction<$$>) => Promise<R>,
  ): Promise<R> {
    const nn_tx = this.newTransaction(stores, mode);
    return nn_tx.run(tx => tx.wrap(callback));
  }

  /**
   * Close the connection to the database.
   */
  // TODO: technically, this must return a Promise<void> to account
  // for the case that this._idb_conn_k is not a bound value; however,
  // that is exactly the case where we wouldn't want to .close() the
  // connection.
  close(): void | Promise<void> {
    return this._idb_conn_k.run(idb_conn => idb_conn.close());
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
      await this.close();
    }
  }

}
