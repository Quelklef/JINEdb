
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
   * This connection must be manually closed. If this scope is well-defined, it is recommended
   * to use [[Database.connect]].
   *
   * @returns A new connection
   */
  async newConnection(): Promise<BoundConnection<$$>> {
    return new BoundConnection<$$>({
      db_name: this.name,
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
   *
   * @returns The callback result
   */
  async connect<T>(callback: (conn: BoundConnection<$$>) => Promise<T>): Promise<T> {
    const conn = await this.newConnection();
    return await conn.wrap(async conn => await callback(conn));
  }

  // vvv We add `tx.genuine` as an argument--and as the FIRST argument--to bring it to the
  //     attention of the API user.
  async upgrade(version: number, callback: (genuine: boolean, tx: Transaction<$$>) => Promise<void>): Promise<void> {
    /* Asynchronously re-open the underlying idb database with the given
    version number, if supplied. If an upgrade function is given, it will be
    attached to the upgradeneeded event of the database open request. */

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
          genuine: version > some(this.version),
          substructures: this._substructures,
          storables: this._storables,
          indexables: this._indexables,
        });

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        invoke(async (): Promise<void> => {
          await tx.wrap(async tx => await callback(tx.genuine, tx));

          // update structure if stores were added etc
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
        resolve();
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
