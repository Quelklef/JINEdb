
import { Transaction } from './transaction';
import { StoreStructure } from './structure';
import { AutonomousStore } from './store';
import { some, invoke, Dict } from './util';
import { newStorableRegistry, StorableRegistry } from './storable';
import { BoundConnection, AutonomousConnection } from './connection';
import { IndexableRegistry, newIndexableRegistry } from './indexable';
import { JineBlockedError, JineInternalError, mapError } from './errors';

async function getDbVersion(db_name: string): Promise<number> {
  /* Return current database version number. Returns an integer greater than or
  equal to zero. Zero denotes that indexedDB does not have a database with this
  database's name. All other version numbers are given by the underlying idb database
  version number.

  This method does NOT prolong the curernt transaction. */

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
 * A database
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

  _substructures: Dict<StoreStructure>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  $: $$;

  constructor(name: string) {
    this.name = name;
    this.version = null;

    this._substructures = {};
    this._storables = newStorableRegistry();
    this._indexables = newIndexableRegistry();

    const self = this;
    this.$ = <$$> new Proxy({}, {
      get(_target: {}, prop: string | number | symbol) {
        if (typeof prop === 'string') {
          const store_name = prop;
          // vvv Mimic missing key returning undefined
          if (!(store_name in self._substructures)) return undefined;
          const aut_store = new AutonomousStore({
            name: store_name,
            conn: new AutonomousConnection({
              db_name: self.name,
              substructures: self._substructures,
              storables: self._storables,
              indexables: self._indexables,
            }),
            structure: some(self._substructures[store_name]),
            storables: self._storables,
            indexables: self._indexables,
          });
          return aut_store;
        }
      }
    });
  }

  async init(): Promise<void> {
    this.version = await getDbVersion(this.name);
  }

  // TODO: there's a better way to wrap requests and handle errors
  // TODO: this should maybe be moved onto BoundConnection
  async _newIdbConn(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name);
      req.onupgradeneeded = _event => reject(new JineInternalError());
      req.onblocked = _event => reject(new JineBlockedError());
      req.onerror = _event => reject(mapError(req.error));
      req.onsuccess = _event => resolve(req.result);
    });
  }

  /**
   * Creates and returns a new connection to the database.
   *
   * Connections created with this method must be manually closed.
   * It's recommended to use [[Database.connect]] instead, which will close the connection for you.
   *
   * @returns A new connection
   */
  async newConnection(): Promise<BoundConnection<$$>> {
    return new BoundConnection<$$>({
      idb_conn: await this._newIdbConn(),
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
   * @typeParam T The return type of the callback.
   * @returns The callback result
   */
  async connect<T>(callback: (conn: BoundConnection<$$>) => Promise<T>): Promise<T> {
    const conn = await this.newConnection();
    return await conn.wrap(async conn => await callback(conn));
  }

  /**
   * Upgrade the database to a new version.
   *
   * This is like [[Database.connect]], except that you are able to update the format of the database,
   * for instance with [[Transaction.addStore]] and [[Store.addIndex]].
   *
   * Also see {@page Versioning and Migrations}.
   *
   * @param version The version to open the database with
   * @param callback The upgrade function
   * @returns The return value of the callback.
   */
  async upgrade<Ret>(version: number, callback: (genuine: boolean, tx: Transaction<$$>) => Promise<Ret>): Promise<Ret> {
    // ^^^ We add `tx.genuine` as an argument (the FIRST argument) to the callback
    //     in order to call it to the attention of the API user

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

      let result: Ret;
      req.onupgradeneeded = _event => {
        const idb_tx = some(req.transaction);
        const tx = new Transaction<$$>({
          idb_tx: idb_tx,
          genuine: version > some(this.version),
          substructures: this._substructures,
          storables: this._storables,
          indexables: this._indexables,
        });

        // vvv The below looks concerning due to the fact that we don't await the promise.
        //     In fact, it's fine; floating callback are natural when working with idb.
        //     The 'after' code doesn't come after awaiting the promise, it comes in onsuccess.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        invoke(async (): Promise<void> => {
          result = await tx.wrap(async tx => await callback(tx.genuine, tx));

          // vvv Update structure if stores were added etc
          if (tx.state !== 'aborted') {
            this._substructures = tx._substructures;
            this._storables = tx._storables;
            this._indexables = tx._indexables;
            if (version > some(this.version)) this.version = version;
          }
        });
      };

      req.onsuccess = _event => {
        const idb_db = req.result;
        idb_db.close();
        resolve(result);
      };

    });
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
