
import { Transaction } from './transaction';
import { some, invoke, Dict } from './util';
import { StoreStructure, AutonomousStore } from './store';
import { BoundConnection, AutonomousConnection } from './connection';
import { newIndexableRegistry, IndexableRegistry } from './indexable';
import { JineBlockedError, JineInternalError, mapError } from './errors';
import { newStorableRegistry, StorableRegistry, Storable } from './storable';

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
 * Represents the structure of a database
 */
export class DatabaseStructure {

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
   * The structures of the stores within this database.
   */
  store_structures: Dict<string, StoreStructure<Storable>>;

  constructor(args: {
    name: string;
    version: number | null;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
    store_structures: Dict<string, StoreStructure<Storable>>;
  }) {
    this.name = args.name;
    this.version = args.version;
    this.store_structures = args.store_structures;
    this.storables = args.storables;
    this.indexables = args.indexables;
  }

  /**
   * The store names. Equivalent to `Object.keys(this.store_structures)`.
   */
  get store_names(): Set<string> {
    return new Set(Object.keys(this.store_structures));
  }

  storables: StorableRegistry;
  indexables: IndexableRegistry;

}

/**
 * A database
 */
export class Database<$$ = {}> {

  /**
   * The structure of the database
   */
  structure: DatabaseStructure;

  $: $$;

  constructor(name: string) {
    this.structure = new DatabaseStructure({
      name: name,
      version: null,
      store_structures: {},
      storables: newStorableRegistry(),
      indexables: newIndexableRegistry(),
    });

    const aut_conn = new AutonomousConnection(this.structure);
    const self = this;
    this.$ = <$$> new Proxy({}, {
      get(_target: {}, prop: string | number | symbol) {
        if (typeof prop === 'string') {
          const store_name = prop;
          const store_structure = some(self.structure.store_structures[store_name]);
          const aut_store = new AutonomousStore(store_structure, aut_conn);
          return aut_store;
        }
      }
    });
  }

  async init(): Promise<void> {
    this.structure.version = await getDbVersion(this.structure.name);
  }

  // TODO: there's a better way to wrap requests and handle errors
  async _newIdbConn(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.structure.name);
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
    const idb_conn = await this._newIdbConn();
    return new BoundConnection<$$>(this.structure, idb_conn);
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

  async upgrade(version: number, callback: (tx: Transaction) => Promise<void>): Promise<void> {
    /* Asynchronously re-open the underlying idb database with the given
    version number, if supplied. If an upgrade function is given, it will be
    attached to the upgradeneeded event of the database open request. */

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.structure.name, version);
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
        const tx = new Transaction<$$>(idb_tx, this.structure)

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        invoke(async (): Promise<void> => {
          if (version < some(this.structure.version))
            await tx.dry_run(async tx => await callback(tx));
          else
            await tx.wrap(async tx => await callback(tx));

          // update structure if stores were added etc
          this.structure.store_structures = tx.structure.store_structures;
          if (version > some(this.structure.version)) this.structure.version = version;
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
      const req = indexedDB.deleteDatabase(this.structure.name);
      req.onerror = _event => reject(mapError(req.error));
      req.onsuccess = _event => resolve();
    });
  }

}
