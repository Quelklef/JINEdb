
import { Store } from './store';
import { Codec } from './codec';
import { PACont } from './cont';
import { Awaitable } from './util';
import { DatabaseSchema } from './schema';
import { JineError, JineNoSuchStoreError, mapError } from './errors';
import { Transaction, TransactionMode, uglifyTransactionMode } from './transaction';

/**
 * Represents a connection to the database.
 *
 * A connection offers no extra functionality beyond a [[Transaction]], but
 * grouping several transactions together into a single connection will be
 * more efficient than creating a new connection for each transaction.
 */
export class Connection<$$ = unknown> {

  /**
   * The connection shorthand object.
   *
   * An operation such as
   * ```ts
   * await conn.$.myStore.add(myitem)
   * ```
   * Will add an item to the database store called `myStore`.
   *
   * Also see {@page Example}.
   */
  $: $$;

  _idbConnCont: PACont<IDBDatabase>;
  _schemaCont: PACont<DatabaseSchema>;
  _codec: Codec;

  constructor(args: {
    idbConnCont: PACont<IDBDatabase>;
    schemaCont: PACont<DatabaseSchema>;
    codec: Codec;
  }) {
    this._idbConnCont = args.idbConnCont;
    this._schemaCont = args.schemaCont;
    this._codec = args.codec;

    this.$ = <$$> new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const storeName = prop;
          const store = new Store({
            txCont: this.newTransactionCont([storeName]),
            schemaCont: this._schemaCont.map(schema => schema.store(storeName)),
            codec: this._codec,
          });
          return store;
        }
      }
    });
  }

  newTransactionCont(stores: Iterable<string | Store<any>>): PACont<Transaction<$$>, TransactionMode> {
    // this could probably be better implemented with a new combinator or something, but that's okay
    return PACont.fromFunc<Transaction<$$>, TransactionMode>(async (callback, txMode) => {
      const txCont = PACont.pair(this._idbConnCont, this._schemaCont).map(async ([idbConn, schema]) => {
        const storeNames = new Set(await Promise.all([...stores].map(s => typeof s === 'string' ? s : s.name)));
        const idbTxMode = uglifyTransactionMode(txMode)

        if (storeNames.size === 0)
          throw new JineError(`Cannot start a transaction without specifying stores on which to transact! Sorry.`);

        let idbTx!: IDBTransaction;
        try {
          idbTx = idbConn.transaction([...storeNames], idbTxMode);
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
          codec: this._codec,
        });
      });

      return await txCont.run(callback);
    });
  }

  /**
   * Run a transaction on the connection.
   *
   * This will create a new [[Transaction]] and run the given callback on it. If
   * The callback completes successfully, the transaction is committed; if the
   * callback throws, then the transaction is aborted.
   */
  async transact<R>(
    stores: Iterable<string | Store<any>>,
    txMode: TransactionMode,
    callback: (tx: Transaction<$$>) => Promise<R>,
  ): Promise<R> {
    const txCont = this.newTransactionCont(stores);
    return txCont.run(txMode, tx => tx.wrap(callback));
  }

  /**
   * Close the connection to the database.
   *
   * This must only be used on connections created with [[Database.newConnection]].
   */
  close(): Awaitable<void> {
    // FIXME: technically, this must return a Promise<void> to account
    // for the case that this._idbConnCont is not a bound value; however,
    // that is exactly the case where we wouldn't want to .close() the
    // connection.
    return this._idbConnCont.run(idbConn => idbConn.close());
  }

  /**
   * Run some code with this connection and then close it afterwards.
   *
   * If the code completes successfully, then the transaction will be
   * committed. If the code throws, then the transaction will be aborted.
   */
  async wrap<R>(callback: (conn: this) => Promise<R>): Promise<R> {
    try {
      return await callback(this);
    } finally {
      await this.close();
    }
  }

}
