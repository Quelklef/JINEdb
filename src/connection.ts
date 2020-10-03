
import { Store } from './store';
import { PACont } from './cont';
import { Awaitable } from './util';
import { DatabaseSchema } from './schema';
import { JineNoSuchStoreError, mapError } from './errors';
import { Transaction, TransactionMode, uglifyTransactionMode } from './transaction';

/**
 * A connection to a database.
 */
export class Connection<$$ = unknown> {

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

  _idbConnCont: PACont<IDBDatabase>;
  _schemaCont: PACont<DatabaseSchema>;

  constructor(args: {
    idbConnCont: PACont<IDBDatabase>;
    schemaCont: PACont<DatabaseSchema>;
  }) {
    this._idbConnCont = args.idbConnCont;
    this._schemaCont = args.schemaCont;

    this.$ = <$$> new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const storeName = prop;
          const store = new Store({
            txCont: this.newTransactionCont([storeName]),
            schemaCont: this._schemaCont.map(schema => schema.store(storeName)),
          });
          return store;
        }
      }
    });
  }

  newTransactionCont(stores: Array<string | Store<any>>): PACont<Transaction<$$>, TransactionMode> {
    // this could probably be better implemented with a new combinator or something, but that's okay
    return PACont.fromFunc<Transaction<$$>, TransactionMode>(async (callback, txMode) => {
      const txCont = PACont.pair(this._idbConnCont, this._schemaCont).map(async ([idbConn, schema]) => {
        const storeNames = await Promise.all(stores.map(s => typeof s === 'string' ? s : s.name));
        const idbTxMode = uglifyTransactionMode(txMode)

        let idbTx!: IDBTransaction;
        try {
          idbTx = idbConn.transaction(storeNames, idbTxMode);
        } catch (err) {
          if (err.name === 'NotFoundError')
            throw new JineNoSuchStoreError({ oneOfStoreNames: storeNames });
          throw mapError(err);
        }

        return new Transaction<$$>({
          idbTx: idbTx,
          scope: storeNames,
          genuine: true,
          schema: schema,
        });
      });
      return await txCont.run(callback);
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
    txMode: TransactionMode,
    callback: (tx: Transaction<$$>) => Promise<R>,
  ): Promise<R> {
    const txCont = this.newTransactionCont(stores);
    return txCont.run(txMode, tx => tx.wrap(callback));
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
