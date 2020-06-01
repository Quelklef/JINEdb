
import { Storable } from './storable';
import { Transaction } from './transaction';
import { some, invoke, Dict } from './util';
import { StoreStructure, AutonomousStore } from './store';
import { BoundConnection, AutonomousConnection } from './connection';

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
      req.onupgradeneeded = _event => reject(Error('upgrade needed'));
      req.onsuccess = _event => {
        const conn = req.result;
        resolve(conn.version);
        conn.close();
      }
      req.onerror = _event => reject(req.error);
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
   */
  version: number;

  /**
   * The structures of the stores within this database.
   */
  store_structures: Dict<string, StoreStructure<Storable>>;

  constructor(args: {
    name: string;
    version: number;
    store_structures: Dict<string, StoreStructure<Storable>>;
  }) {
    this.name = args.name;
    this.version = args.version;
    this.store_structures = args.store_structures;
  }

  /**
   * The store names. Equivalent to `Object.keys(this.store_structures)`.
   */
  get store_names(): Set<string> {
    return new Set(Object.keys(this.store_structures));
  }

}

/**
 * A database
 */
export class Database<$$ = {}> {

  /**
   * The structure of the database
   */
  structure: DatabaseStructure;

  constructor(name: string) {
    this.structure = new DatabaseStructure({
      name: name,
      version: 0,
      store_structures: {},
    });
  }

  _withShorthand(): $$ & this {
    const conn = new AutonomousConnection(this.structure);
    for (const store_name of this.structure.store_names) {
      const store_structure = some(this.structure.store_structures[store_name]);
      const store = new AutonomousStore(store_structure, conn);
      (this as any)['$' + store_name] = store._withShorthand();
    }
    const $$this = this as any as $$ & this;
    return $$this;
  }

  async _newIdbConn(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.structure.name, this.structure.version);
      req.onupgradeneeded = _event => reject(Error('Upgrade needed.'));
      req.onsuccess = _event => resolve(req.result);
      req.onerror = _event => reject(req.error);
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
  async newConnection(): Promise<$$ & BoundConnection<$$>> {
    const idb_conn = await this._newIdbConn();
    const conn = new BoundConnection<$$>(this.structure, idb_conn);
    return conn._withShorthand();
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
  async connect<T>(callback: (conn: $$ & BoundConnection<$$>) => Promise<T>): Promise<T> {
    const conn = await this.newConnection();
    const result = await callback(conn);
    conn.close();
    return result;
  }

  async upgrade(version: number, callback: (tx: Transaction) => Promise<void>): Promise<void> {
    /* Asynchronously re-open the underlying idb database with the given
    version number, if supplied. If an upgrade function is given, it will be
    attached to the upgradeneeded event of the database open request. */

    const idb_version = await getDbVersion(this.structure.name);
    const do_dry_run = version < this.structure.version || version < idb_version;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.structure.name, version);
      req.onupgradeneeded = _event => {
        const idb_tx = some(req.transaction);
        const tx = new Transaction<$$>(idb_tx, this.structure)

        const run_promise = invoke(async () => {
          if (do_dry_run)
            await tx.dry_run(async tx => await callback(tx));
          else
            await tx.wrap(async tx => await callback(tx));

          // update structure if stores were added etc
          this.structure.store_structures = tx.structure.store_structures;
          this.structure.version = version;
          // TODO: switch to Proxy-based _withShorthand
          this._withShorthand();
        });

        run_promise
          .then(result => resolve(result),
                reason => reject(reason));
      };
      req.onsuccess = _event => {
        const idb_db = req.result;
        idb_db.close();
        resolve();
      };
      req.onerror = _event => {
        reject(req.error);
      };
    });
  }

  /**
   * Delete the database.
   */
  async destroy(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(this.structure.name);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

}
