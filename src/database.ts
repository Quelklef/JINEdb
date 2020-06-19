
import { Store } from './store';
import { AsyncCont } from './cont';
import { Connection } from './connection';
import { StoreStructure } from './structure';
import { Transaction, TransactionMode } from './transaction';
import { IndexableRegistry, newIndexableRegistry } from './indexable';
import { some, invoke, Dict, DOMStringList_to_Array } from './util';
import { JineBlockedError, JineInternalError, mapError } from './errors';
import { Storable, newStorableRegistry, StorableRegistry } from './storable';

async function getDbVersion(db_name: string): Promise<number> {
  /* Return current database version number. Returns an integer greater than or
  equal to zero. Zero denotes that indexedDB does not have a database with this
  database's name. All other version numbers are given by the underlying idb database
  version number.

  This method does NOT prolong the current transaction. */

  const database_names: Array<string> =
    // [2020-05-17] types don't include .databases() but docs do:
    // https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/databases
    (await (indexedDB as any).databases() as Array<IDBDatabase>)
    .map(idb_db => idb_db.name);

  if (!database_names.includes(db_name)) {
    return 0;
  } else {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(db_name);
      req.onupgradeneeded = _event => reject(new JineInternalError());
      req.onblocked = _event => reject(new JineBlockedError());
      req.onsuccess = _event => {
        const conn = req.result;
        resolve(conn.version);
        conn.close();
      }
      req.onerror = _event => reject(mapError(req.error));
    });
  }
}



/**
 * Represents a Database, which houses several item [[Store]]s contain data, queryable by [[Index]]es.
 */
export class Database<$$ = {}> {

  /**
   * The name of the database.
   * Database names are unique.
   */
  name: string;

  /**
   * The version of the database.
   * Database versions are integers greater than zero.
   *
   * Null if the database has not yet been initialized.
   */
  version: number | null;

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
  
  _substructures: Dict<StoreStructure>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  _migrations: Record<number, (genuine: boolean, tx: Transaction<$$>) => Promise<void>>;

  constructor(name: string) {
    this.name = name;
    this.version = null;

    this._substructures = {};
    this._storables = newStorableRegistry();
    this._indexables = newIndexableRegistry();

    this._migrations = {};

    const self = this;
    this.$ = <$$> new Proxy({}, {
      get(_target: {}, prop: string | number | symbol) {
        if (typeof prop === 'string') {
          const store_name = prop;
          // vvv Mimic missing key returning undefined
          if (!(store_name in self._substructures)) return undefined;

          const idb_conn_k = AsyncCont.fromProducer(async () => await self._newIdbConn());
          const idb_store_k = idb_conn_k.map(idb_conn => {
            // TODO: how to tell what mode? cant hardcode readwrie
            const idb_tx = idb_conn.transaction([store_name], 'readwrite');
            const idb_store = idb_tx.objectStore(store_name);
            return idb_store;
          });
          const store = new Store({
            idb_store_k: idb_store_k,
            structure: some(self._substructures[store_name]),
            storables: self._storables,
            indexables: self._indexables,
          });

          return store;
        }
      }
    });
  }

  /**
   * Stage a database migration.
   *
   * The migration will be run when the database is initialized.
   *
   * @param version The version to upgrade to
   * @param callback The upgrade function.
   */
  migration(version: number, callback: (genuine: boolean, tx: Transaction<$$>) => Promise<void>): void {
    if (this.initialized)
      throw Error('Cannot stage a migration on an already-initialized database.');
    if (version in this._migrations)
      throw Error(`There is already a staged migration for version ${version}.`);
    this._migrations[version] = callback;
  }

  /**
   * Has the database been initialized?
   */
  get initialized(): boolean {
    return this.version !== null;
  }

  /**
   * Initialize the database.
   *
   * Typiically you don't need to call this function yourself, as the database will automatically
   * initialize itself before any operation.
   *
   * Database initialization essentially consists of running all migrations and updating internal
   * state according to the migrations.
   */
  async initialize(): Promise<void> {

    if (this.initialized)
      throw Error('This database has already been initialized.');

    this.version = await getDbVersion(this.name);

    const versions =
      Object.keys(this._migrations)
        .map((key: string) => parseInt(key))
        .sort();

    for (const version of versions) {
      await this._upgrade(version, this._migrations[version]);
    }

  }

  async _ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.initialize();
  }

  /**
   * Upgrade the database to a new version.
   *
   * Like [[Database.connect]], except that the callback is allowed to update the format of the database,
   * for instance with [[Transaction.addStore]] and [[StoreActual.addIndex]].
   *
   * The callback accepts an extra argument, `genuine`. This value is equal to `tx.genuine` and is `true`
   * exactly when the upgrade is being done "for real" instead of being used to recalculate database shape.
   *
   * Also see {@page Versioning and Migrations}.
   *
   * Generally, one should prefer [[Database.migration]] to this method.
   * However, this method can be useful when fine-grained control is desired.
   *
   * The given migration will be run after all staged migrations are run.
   *
   * @param version The version to upgrade to
   * @param callback The upgrade function.
   */
  async upgrade(version: number, callback: (genuine: boolean, tx: Transaction<$$>) => Promise<void>): Promise<void> {
    await this._ensureInitialized();
    await this._upgrade(version, callback);
  }

  // Run a database migration
  // Will only run a genuine migration if the version is greater than the current db version
  async _upgrade(version: number, callback: (genuine: boolean, tx: Transaction<$$>) => Promise<void>): Promise<void> {

    const genuine = version > some(this.version);

    const invokeAndUpdate = async (tx: Transaction<$$>): Promise<void> => {
      // Invoke the callback with the given transaction
      // Use the results to upgrade the database info
      
      await tx.wrap(async tx => await callback(genuine, tx));

      // vvv Update structure if stores were added etc
      // TODO: the `(!tx.genuine ||` is included because ingeuine transactions ARE aborted.
      // however, this will (wronlgy) update structure from
      // a genuinely user-aborted ingenuine transaction
      if (!tx.genuine || tx.state !== 'aborted') {
        this._substructures = tx._substructures;
        this._storables = tx._storables;
        this._indexables = tx._indexables;
        this.version = version;
      }
    };

    return new Promise((resolve, reject) => {

      const req = indexedDB.open(this.name, version);

      req.onblocked = _event => reject(new JineBlockedError());

      req.onerror = _event => {
        const idb_error = req.error;
        // A .abort call in a versionchange tx should not raise an error
        if (idb_error?.name === 'AbortError') {
          resolve();
        } else {
          reject(mapError(req.error));
        }
      };

      req.onupgradeneeded = _event => {
        const idb_tx = some(req.transaction);
        const tx = new Transaction<$$>({
          idb_tx: idb_tx,
          genuine: genuine,
          substructures: this._substructures,
          storables: this._storables,
          indexables: this._indexables,
        });

        // (*)
        // vvv The below looks concerning due to the fact that we don't await the promise.
        //     In fact, it's fine; floating callback are natural when working with idb.
        //     The 'after' code doesn't come after awaiting the promise, it comes in onsuccess.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        invokeAndUpdate(tx);
      };

      if (genuine) {
        req.onsuccess = _event => {
          const idb_conn = req.result;
          idb_conn.close();
          resolve();
        };
      } else {
        req.onsuccess = _event => {
          // vvv See (*)
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          invoke(async () => {
            
            const idb_conn = req.result;
            // open a readonly transaction with all object stores
            const idb_tx = idb_conn.transaction(DOMStringList_to_Array(idb_conn.objectStoreNames), 'readonly');

            // If we didn't do a version change, we still need to
            // upgrade the internal structure info
            const tx = new Transaction<$$>({
              idb_tx: idb_tx,
              genuine: genuine,
              substructures: this._substructures,
              storables: this._storables,
              indexables: this._indexables,
            });
            
            await invokeAndUpdate(tx);

            idb_conn.close();
            resolve();

          });
        };
      }

    });
  }

  // TODO: there's a better way to wrap requests and handle errors
  async _newIdbConn(): Promise<IDBDatabase> {
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
    await this._ensureInitialized();
    return new Connection<$$>({
      // vvv Yes, we want to `await this._newIdbConn`; this provides the guarantee
      //     that consumers of the continuation never have to wait
      // TODO: remove this :)  -- it should cause problems in Selection#asyncIterator
      idb_conn_k: AsyncCont.fromValue(await this._newIdbConn()),
      substructures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
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
    await this._ensureInitialized();
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
  async transact<R>(stores: Array<string | Store<Storable>>, mode: TransactionMode, callback: (tx: Transaction<$$>) => Promise<R>): Promise<R> {
    await this._ensureInitialized();
    return await this.connect(async conn =>
      await conn.transact(stores, mode, async tx =>
        await callback(tx)));
  }

  /**
   * Delete the database.
   */
  async destroy(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(this.name);
      req.onerror = _event => reject(mapError(req.error));
      req.onsuccess = _event => resolve();
    });
  }

}
