
import { Store } from './store';
import { AsyncCont } from './cont';
import { Connection } from './connection';
import { DatabaseSchema } from './schema';
import { Codec, UserCodec } from './codec';
import { Transaction, TransactionMode } from './transaction';
import { JineBlockedError, JineInternalError, mapError } from './errors';

async function getDbVersion(name: string): Promise<number> {
  /* Return current database version number. Returns an integer greater than or
  equal to zero. Zero denotes that indexedDB does not have a database with this
  database's name. All other version numbers are given by the underlying idb database
  version number.

  This method does NOT prolong the current transaction. */

  // The obvious way to implement this is to return 0 if the given name
  // is not in indexedDB.databases and otherwise run a transaction to
  // find out.
  // However, Firefox does not have indexedDB.databases implemented at
  // the moment (2020-07-29), so instead we'll run a transaction and
  // return 0 if the upgradeneeded event fired.

  return new Promise((resolve, reject) => {

    let previouslyExisted = true;

    const openReq = indexedDB.open(name);

    openReq.onblocked = _event => reject(new JineBlockedError());
    openReq.onerror = _event => reject(mapError(openReq.error));

    openReq.onupgradeneeded = _event => {
      previouslyExisted = false;
    };

    openReq.onsuccess = _event => {
      const conn = openReq.result;
      const version = previouslyExisted ? conn.version : 0;
      conn.close();

      if (previouslyExisted) {
        resolve(version);
      } else {
        const delReq = indexedDB.deleteDatabase(name);
        delReq.onerror = _event => reject(mapError(delReq.error));
        delReq.onsuccess = _event => resolve(version);
      }
    };

  });
}



type Migration<$$> = (genuine: boolean, tx: Transaction<$$>) => Promise<void>;

async function runMigrations<$$>(name: string, migrations: Array<Migration<$$>>, userCodecs: Array<UserCodec>): Promise<[number, DatabaseSchema]> {
  let version = await getDbVersion(name);
  let schema = new DatabaseSchema({
    name: name,
    stores: {},
    codec: new Codec(userCodecs),
  });

  // Reset dummy database
  const dummyName = '__JINE_DUMMY__' + name;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dummyName);
    req.onerror = _event => reject(mapError(req.error));
    req.onsuccess = _event => resolve();
  });

  for (let idx = 0; idx < migrations.length; idx++) {
    const migration = migrations[idx]
    const toVersion = idx + 1;
    [version, schema] = await runMigration(name, version, schema, migration, toVersion);
  }

  return [version, schema];
}

function runMigration<$$>(name: string, version: number, schema: DatabaseSchema, migration: Migration<$$>, toVersion: number): Promise<[number, DatabaseSchema]> {

  const genuine = toVersion > version;

  return new Promise((resolve, reject) => {

    // For genuine transactions, we run it on the actual database
    // For ingenuine transactions, we run it on a parallel 'dummy' database
    // which is always reset when the database is initialized.
    // Thus the migrations run in a dummy environment until we reach the
    // point that the actual database is at, when they switch to being run
    // on the actual db.
    const req =
      genuine
        ? indexedDB.open(name, toVersion)
        : indexedDB.open('__JINE_DUMMY__' + name, toVersion)
        ;

    req.onblocked = _event => {
      reject(new JineBlockedError());
    };

    req.onerror = _event => {
      const idbError = req.error;
      if (idbError?.name === 'AbortError') {
        reject(Error(`[Jine] A migration was aborted! This is not allowed.`));
      } else {
        reject(mapError(req.error));
      }
    };

    const newVersion = genuine ? toVersion : version;
    let newSchema = null as null | DatabaseSchema;
    let upgradeNeededCalled = false;

    req.onupgradeneeded = _event => {
      upgradeNeededCalled = true;

      if (!req.transaction) throw new JineInternalError();
      const idbTx = req.transaction;
      const tx = new Transaction<$$>({
        idb_tx: idbTx,
        // vvv Versionchange transactions have access to entire db
        scope: schema.store_names,
        genuine: genuine,
        schema: schema,
      });

      // vvv The below looks concerning due to the fact that we don't await the promise.
      //     In fact, it's fine; floating callbacks are natural when working with idb
      //     (as long as they don't span multiple ticks).
      //     The 'after' code doesn't come after awaiting the promise, it comes in onsuccess.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      tx.wrap(async tx => {
        await migration(genuine, tx);

        // vvv Update structure if stores were added etc
        // TODO: for some reason, we still reach this line of code when the transaction
        //       was aborted. I'm not sure why that is?
        if (tx.state === 'aborted')
          reject(Error(`[Jine] A migration was aborted! This is not allowed.`));
        else
          newSchema = tx._schema;
      });
    };

    req.onsuccess = _event => {
      if (!upgradeNeededCalled) throw new JineInternalError()
      if (newSchema === null)
        throw Error(`[Jine] A migration seems to have ended prematurely. Did you mistakenly let the transcation close, e.g. by awaiting something other than a db operation?`);
      const idbConn = req.result;
      idbConn.close();
      resolve([newVersion, newSchema]);
    };

  });
}

/**
 * Represents a Database, which houses several item [[Store]]s contain data, queryable by [[Index]]es.
 */
export class Database<$$> {

  /**
   * The name of the database.
   * Database names are unique.
   */
  name: string;

  /**
   * The database version.
   * Database versions are integers greater than zero.
   */
  version: Promise<number>;

  /**
   * The Database shorthand object.
   * Used for doing one-off database operations.
   *
   * An operation such as
   * ```plaintext
   * await db.$.my_store.add(my_item)
   * ```
   * will automatically open up a [[Connection]], start a [[Transaction]], run the `.add` operation,
   * close the transaction, and close the connection.
   */
  $: $$;

  /**
   * Resolves when the database is finished initializing;
   *
   * When the database is created, it will immediately begin running migrations.
   * All database operations will wait for these migrations to finish before actually
   * taking the action. However, this means that before `await`ing a database operation,
   * you are *not* guaranteed about the state of the database. Weird things can happen
   * if, say, you open a new database with the same name while an existing one is
   * still initializing.
   *
   * If there is an issue when migrating, this value will never resolve, and an
   * error will be printed into the console.
   *
   * So, if you need to gaurantee that the database is initialized, but
   * don't want to do any operations to do this, you can await this attribute.
   */
  initialized: Promise<void>;

  _schema: Promise<DatabaseSchema>;

  constructor(name: string, args: { migrations: Array<Migration<$$>>; types?: Array<UserCodec> }) {
    if (name.startsWith("__JINE_DUMMY__"))
      throw new Error("Jine db names may not start with '__JINE_DUMMY__'");

    const versionAndSchemaPromise: Promise<[number, DatabaseSchema]> =
      runMigrations(name, args.migrations, args.types ?? [])
      .catch(err => {
        console.error(`[Jine] There was an error migrating the database:`, err);
        return new Promise(() => {});  // never resolve so that no db operations can go through
      });

    this.name = name;
    this.version = versionAndSchemaPromise.then(([version, _]) => version);
    this._schema = versionAndSchemaPromise.then(([_, schema]) => schema);
    this.initialized = versionAndSchemaPromise.then(() => undefined);

    this.$ = <$$> new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const store_name = prop;

          const idb_conn_k = AsyncCont.fromFunc<IDBDatabase>(async callback => {
            const idbConn = await this._newIdbConn();
            const result = await callback(idbConn);
            idbConn.close();
            return result;
          });
          const conn = new Connection({
            idb_conn_k: idb_conn_k,
            schema_k: AsyncCont.fromValue(this._schema),
          });
          return (conn.$ as any)[store_name];
        }
      }
    });
  }

  // TODO: there's a better way to wrap requests and handle errors
  async _newIdbConn(): Promise<IDBDatabase> {
    await this.initialized;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name);
      // vvv upgradeneeded shouldn't fire
      req.onupgradeneeded = _event => reject(new JineInternalError());
      req.onblocked = _event => reject(new JineBlockedError());
      req.onerror = _event => reject(mapError(req.error));
      req.onsuccess = _event => resolve(req.result);
    });
  }

  /**
   * Create new connection to the database.
   *
   * Unlike with [[Database.connect]], connections created with this method must be manually closed.
   *
   * @returns A new connection
   */
  async newConnection(): Promise<Connection<$$>> {
    return new Connection<$$>({
      idb_conn_k: AsyncCont.fromValue(await this._newIdbConn()),
      schema_k: AsyncCont.fromValue(await this._schema),
    });
  }

  /**
   * Connect to a database and run some code.
   *
   * This will create a new connection to the database, run the given callback, and then
   * close the connection once the callback has completed.
   *
   * @param callback The function to run with the database connection.
   * @typeparam T The return type of the callback.
   * @returns The callback result
   */
  async connect<R>(callback: (conn: Connection<$$>) => Promise<R>): Promise<R> {
    const conn = await this.newConnection();
    return await conn.wrap(async conn => await callback(conn));
  }

  /**
   * Convenience method for creating a single-use connection and transacting on it.
   *
   * The code
   * ```ts
   * await db.transact(tx => ...);
   * ```
   * is shorthand for
   * ```ts
   * await db.connect(async conn => await conn.transact(tx => ...))
   * ```
   */
  async transact<R>(stores: Array<string | Store<unknown>>, mode: TransactionMode, callback: (tx: Transaction<$$>) => Promise<R>): Promise<R> {
    return await this.connect(async conn => {
      return await conn.transact(stores, mode, async tx => {
        return await callback(tx);
      });
    });
  }

}
