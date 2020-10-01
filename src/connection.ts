
import { Store } from './store';
import { AsyncCont } from './cont';
import { Awaitable } from './util';
import { DatabaseSchema } from './schema';
import { JineNoSuchStoreError } from './errors';
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
  _schema_k: AsyncCont<DatabaseSchema>;

  constructor(args: {
    idb_conn_k: AsyncCont<IDBDatabase>;
    schema_k: AsyncCont<DatabaseSchema>;
  }) {
    this._idb_conn_k = args.idb_conn_k;
    this._schema_k = args.schema_k;

    this.$ = <$$> new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const store_name = prop;
          const idb_store_k = this._idb_conn_k.map(idb_conn => {
            let idb_tx!: IDBTransaction;
            try {
              idb_tx = idb_conn.transaction([store_name], 'readwrite');
            } catch (err) {
              if (err.name === 'NotFoundError')
                throw new JineNoSuchStoreError(`No store named '${store_name}'.`);
              throw err;
            }
            return idb_tx.objectStore(store_name);
          });
          const store = new Store({
            idb_store_k: idb_store_k,
            schema_k: this._schema_k.map(schema => schema.store(store_name)),
          });
          return store;
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
    return this._idb_conn_k.and(this._schema_k).map(async ([idb_conn, schema]) => {
      const store_names = await Promise.all(stores.map(s => typeof s === 'string' ? s : s.name));
      const idb_tx_mode = uglifyTransactionMode(tx_mode)
      return new Transaction<$$>({
        idb_tx: idb_conn.transaction(store_names, idb_tx_mode),
        scope: store_names,
        genuine: true,
        schema: schema,
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
  close(): Awaitable<void> {
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
