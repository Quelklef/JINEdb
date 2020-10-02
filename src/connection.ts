
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
   * await conn.$.myStore.add(myitem)
   * ```
   * will automatically open start a [[Transaction]], run the `.add` operation,
   * then close the transaction.
   */
  $: $$;

  _idbConnCont: AsyncCont<IDBDatabase>;
  _schemaCont: AsyncCont<DatabaseSchema>;

  constructor(args: {
    idbConnCont: AsyncCont<IDBDatabase>;
    schemaCont: AsyncCont<DatabaseSchema>;
  }) {
    this._idbConnCont = args.idbConnCont;
    this._schemaCont = args.schemaCont;

    this.$ = <$$> new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const storeName = prop;
          const idbStoreCont = this._idbConnCont.map(idbConn => {
            let idbTx!: IDBTransaction;
            try {
              idbTx = idbConn.transaction([storeName], 'readwrite');
            } catch (err) {
              if (err.name === 'NotFoundError')
                throw new JineNoSuchStoreError(`No store named '${storeName}'.`);
              throw err;
            }
            return idbTx.objectStore(storeName);
          });
          const store = new Store({
            idbStoreCont: idbStoreCont,
            schemaCont: this._schemaCont.map(schema => schema.store(storeName)),
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
  newTransaction(stores: Array<string | Store<any>>, txMode: TransactionMode): AsyncCont<Transaction<$$>> {
    return AsyncCont.tuple(this._idbConnCont, this._schemaCont).map(async ([idbConn, schema]) => {
      const storeNames = await Promise.all(stores.map(s => typeof s === 'string' ? s : s.name));
      const idbTxMode = uglifyTransactionMode(txMode)
      return new Transaction<$$>({
        idbTx: idbConn.transaction(storeNames, idbTxMode),
        scope: storeNames,
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
    const txCont = this.newTransaction(stores, mode);
    return txCont.run(tx => tx.wrap(callback));
  }

  /**
   * Close the connection to the database.
   */
  // TODO: technically, this must return a Promise<void> to account
  // for the case that this._idbConnCont is not a bound value; however,
  // that is exactly the case where we wouldn't want to .close() the
  // connection.
  close(): Awaitable<void> {
    return this._idbConnCont.run(idbConn => idbConn.close());
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
