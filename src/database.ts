
import { M } from 'wrongish';

import { Index } from './index';
import { Store } from './store';
import { PACont } from './cont';
import { Connection } from './connection';
import { DatabaseSchema } from './schema';
import { Transaction, TransactionMode } from './transaction';
import { Codec, UserCodec, NativelyStorable } from './codec';
import { JineError, JineBlockedError, JineInternalError, mapError } from './errors';

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


/**
 * The database shape during migrations.
 *
 * The essential meaning of this is that items access during migrations will *not*
 * be encoded or decoded, and indexes are *not* available during migrations.
 */
export type MigrationTx = Transaction<{
  [storeName: string]: Store<NativelyStorable> & {
    by: {
      [indexName: string]: Index<NativelyStorable, never>;
    };
  };
}>;

/**
 * A database migration.
 *
 * A migration is a function that is given a [[Transaction]] and is allowed to
 * do as it pleases with it. Migrations have special access to [[Transaction.addStore]],
 * [[Transaction.removeStore]], [[Store.addIndex]], and [[Store.removeIndex]] to
 * allow you to change the shape of your database. Additionally, migrations are
 * not allowed to access store indexes.
 *
 * See {@page Example} for example use of a Migration.
 */
type Migration = (genuine: boolean, tx: MigrationTx) => Promise<void>;

async function runMigrations<$$>(dbName: string, migrations: Array<Migration>, codec: Codec): Promise<[number, DatabaseSchema]> {

  // Reset dummy database
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('jine/dummy:' + dbName);
    req.onerror = _event => reject(mapError(req.error));
    req.onsuccess = _event => resolve();
  });

  let dbVersion = await getDbVersion('jine/legit:' + dbName);
  let dbSchema = new DatabaseSchema({
    name: dbName,
    stores: {},
  });

  for (let idx = 0; idx < migrations.length; idx++) {
    const migration = migrations[idx]
    const toVersion = idx + 1;
    [dbVersion, dbSchema] = await runMigration(dbName, dbVersion, dbSchema, migration, toVersion);
  }

  await ensureIndexesPopulated(dbName, dbSchema, codec);

  return [dbVersion, dbSchema];
}

async function ensureIndexesPopulated(dbName: string, dbSchema: DatabaseSchema, codec: Codec): Promise<void> {
  // During migrations, Store#add and Store#addIndex don't calculate traits, so we need to do that here.
  // (The reason they don't is that calculating traits requires the codec; migrations may not use the
  //  codec since it may change version-to-version. Doing it all at the end is okay because we'd
  //  imagine the result db schema to match up with the codec. In other words: suppose an index that used
  //  a custom type was added in migration 2 and removed in migration 6. If in migratiosn we eagerly resolved
  //  traits for Store#add and Store#addIndex, a fresh DB running migrations may fail since it would
  //  be unable to calculate traits between versions 2-6 for this index. However, if we instead defer all
  //  trait calculation to after running all migrations, then we will see that the index is now gone and
  //  will not bother with it; as for all remaining indexes, it is fair to assume that an index that
  //  has not been removed will be supported by the codec.)

  if (dbSchema.storeNames.size === 0)
    // Nothing to do!!
    // Also, continuing will error because we will end up trying to make an idb transaction with
    // empty scope, which is not allowed.
    return;

  const idbConnCont = PACont.fromFunc<IDBDatabase>(callback => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('jine/legit:' + dbName);
      req.onupgradeneeded = _event => reject(new JineInternalError());
      req.onblocked = _event => reject(new JineBlockedError());
      req.onerror = _event => reject(mapError(req.error));
      req.onsuccess = _event => {
        const idbConn = req.result;
        // vv Floating promise since callback is expected to keep connection alive
        Promise.resolve(callback(idbConn))  // eslint-disable-line @typescript-eslint/no-floating-promises
          .then(result => { idbConn.close(); return result; })
          .then(resolve, reject);
      };
    })
  });

  const conn = new Connection({
    idbConnCont: idbConnCont,
    schemaCont: PACont.fromValue(dbSchema),
    codec: codec,
  });

  await conn.transact(dbSchema.storeNames, 'rw', async tx => {
    for (const storeName of dbSchema.storeNames) {
      const storeSchema = dbSchema.store(storeName);
      await M.a(tx.stores[storeName]).selectAll().replaceRows(row => {
        for (const indexName of storeSchema.indexNames) {
          const indexSchema = storeSchema.index(indexName);
          if (!(indexName in row.traits)) {
            const item = codec.decodeItem(row.payload);
            const traitValue = indexSchema.calcTrait(item);
            const traitName = indexName;
            row.traits[traitName] = codec.encodeTrait(traitValue, indexSchema.explode);
          }
        }
        return row;
      });
    }
  });

}

function runMigration<$$>(
  dbName: string,
  dbVersion: number,
  dbSchema: DatabaseSchema,
  migration: Migration,
  toVersion: number,
): Promise<[number, DatabaseSchema]> {

  const txIsGenuine = toVersion > dbVersion;

  return new Promise((resolve, reject) => {

    // For genuine transactions, we run it on the actual database
    // For ingenuine transactions, we run it on a parallel 'dummy' database
    // which is always reset when the database is initialized.
    // Thus the migrations run in a dummy environment until we reach the
    // point that the actual database is at, when they switch to being run
    // on the actual db.
    const req =
      txIsGenuine
        ? indexedDB.open('jine/legit:' + dbName, toVersion)
        : indexedDB.open('jine/dummy:' + dbName, toVersion)
        ;

    req.onblocked = _event => {
      reject(new JineBlockedError());
    };

    req.onerror = _event => {
      const idbError = req.error;
      if (idbError?.name === 'AbortError') {
        reject(new JineError(`A migration was aborted! This is not allowed.`));
      } else {
        reject(mapError(req.error));
      }
    };

    const newVersion = txIsGenuine ? toVersion : dbVersion;
    let newSchema = null as null | DatabaseSchema;
    let upgradeNeededCalled = false;

    req.onupgradeneeded = _event => {
      upgradeNeededCalled = true;

      if (!req.transaction) throw new JineInternalError();
      const idbTx = req.transaction;
      const tx: MigrationTx = new Transaction({
        idbTx: idbTx,
        // vv Versionchange transactions have access to entire db
        scope: dbSchema.storeNames,
        genuine: txIsGenuine,
        schema: dbSchema,
        codec: Codec.migrationCodec(),
      });

      // vv The below looks concerning due to the fact that we don't await the promise.
      //    In fact, it's fine; floating callbacks are natural when working with idb
      //    (as long as they don't span multiple ticks).
      //    The 'after' code doesn't come after awaiting the promise, it comes in onsuccess.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      tx.wrap(async tx => {
        await migration(txIsGenuine, tx);

        // vv Update structure if stores were added etc
        // TODO: for some reason, we still reach this line of code when the transaction
        //       was aborted. I'm not sure why that is?
        if (tx.state === 'aborted')
          reject(new JineError(`A migration was aborted! This is not allowed.`));
        else
          newSchema = tx._schema;
      });
    };

    req.onsuccess = _event => {
      if (!upgradeNeededCalled) throw new JineInternalError()
      if (newSchema === null)
        throw new JineError(`A migration seems to have ended prematurely. Did you mistakenly let the transaction close, e.g. by awaiting something other than a db operation?`);
      const idbConn = req.result;
      idbConn.close();
      resolve([newVersion, newSchema]);
    };

  });
}

/**
 * A Jine Database.
 *
 * The purpose of a [[Database]] is to store data. The data is organized into several
 * item [[Stores]], which are queryable by [[Index]]es. The shape of the database, i.e.
 * what stores it contains and what indexes those contain, are defined during migrations.
 */
export class Database<$$> {

  /**
   * The name of the database. Database names are unique.
   */
  public readonly name: string;

  /**
   * The database version. This is an integer equal to the number of migrations given.
   */
  public readonly version: Promise<number>;

  /**
   * The database shorthand object.
   *
   * An operation such as
   * ```ts
   * await db.$.myStore.add(myitem)
   * ```
   * Will add an item to the database store called `myStore`.
   *
   * Also see {@page Example}.
   */
  public readonly $: $$;

  /**
   * Resolves when the database is finished initializing.
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
  public readonly initialized: Promise<void>;

  private readonly _schema: Promise<DatabaseSchema>;
  private readonly _codec: Codec;

  /**
   * Creates a database with the given name and according to the given migrations
   * and custom types.
   *
   * See {@page Example} for example database construction.
   *
   * @param name The database name. Must be unique.
   * @param args The database migrations as well as codecs for custom datatypes.
   */
  constructor(name: string, args: { migrations: Array<Migration>; types?: Array<UserCodec> }) {
    if (args.migrations.length === 0)
      throw new JineError(`Databases must be given at least one migration.`);

    this._codec = Codec.usualCodec(args?.types ?? []);

    const versionAndSchemaPromise: Promise<[number, DatabaseSchema]> =
      runMigrations(name, args.migrations, this._codec)
      .catch(err => {
        console.error(`There was an error migrating the database:`, err);
        return new Promise(() => {});  // never resolve so that no db operations can go through
      });

    this.name = name;
    this.version = versionAndSchemaPromise.then(([version, _]) => version);
    this._schema = versionAndSchemaPromise.then(([_, schema]) => schema);
    this.initialized = versionAndSchemaPromise.then(() => undefined);

    this.$ = <$$> new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const storeName = prop;

          const idbConnCont = PACont.fromFunc<IDBDatabase>(async callback => {
            const idbConn = await this._newIdbConn();
            const result = await callback(idbConn);
            idbConn.close();
            return result;
          });
          const conn = new Connection({
            idbConnCont: idbConnCont,
            schemaCont: PACont.fromValue(this._schema),
            codec: this._codec,
          });
          return (conn.$ as any)[storeName];
        }
      }
    });
  }

  private async _newIdbConn(): Promise<IDBDatabase> {
    await this.initialized;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('jine/legit:' + this.name);
      // vv Upgradeneeded shouldn't fire since we don't provide a version
      req.onupgradeneeded = _event => reject(new JineInternalError());
      req.onblocked = _event => reject(new JineBlockedError());
      req.onerror = _event => reject(mapError(req.error));
      req.onsuccess = _event => resolve(req.result);
    });
  }

  /**
   * Create new connection to the database.
   *
   * Unlike with [[Database.connect]], connections created with this method must be
   * manually closed via [[Connection.close]].
   */
  async newConnection(): Promise<Connection<$$>> {
    return new Connection<$$>({
      idbConnCont: PACont.fromValue(await this._newIdbConn()),
      schemaCont: PACont.fromValue(await this._schema),
      codec: this._codec,
    });
  }

  /**
   * Create a [[Connection]] to a database and run some code.
   *
   * This will create a new [[Connection]] to the database, run the given callback, and then
   * close the connection once the callback has completed.
   */
  async connect<R>(callback: (conn: Connection<$$>) => Promise<R>): Promise<R> {
    const conn = await this.newConnection();
    return await conn.wrap(async conn => await callback(conn));
  }

  /**
   * Perform a [[Transaction]] on a database.
   *
   * This will create a new [[Connection] to the database, create a new [[Transaction]] on
   * that connection, run the given callback, close the transaction, and then close the
   * connection once the callback has completed.
   */
  async transact<R>(stores: Array<string | Store<any>>, mode: TransactionMode, callback: (tx: Transaction<$$>) => Promise<R>): Promise<R> {
    return await this.connect(async conn => {
      return await conn.transact(stores, mode, async tx => {
        return await callback(tx);
      });
    });
  }

}
