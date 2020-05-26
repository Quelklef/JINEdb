
import { Storable } from './storable';
import { some, Dict } from './util';
import { StoreStructure, AutonomousStore } from './store';
import { MigrationSpec, Migrations } from './migration';
import { BoundConnection, AutonomousConnection } from './connection';
import { Transaction } from './transaction';

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

export class DatabaseStructure {

  public name: string;
  public version: number;
  public store_structures: Dict<string, StoreStructure<Storable>>;

  constructor(args: {
    name: string;
    version: number;
    store_structures: Dict<string, StoreStructure<Storable>>;
  }) {
    this.name = args.name;
    this.version = args.version;
    this.store_structures = args.store_structures;
  }

  get store_names(): Set<string> {
    return new Set(Object.keys(this.store_structures));
  }

}

export class Database<$$ = {}> {

  structure!: DatabaseStructure;
  migrations: Migrations;

  static readonly _allow_construction: symbol = Symbol();
  constructor(override: any, migrations: Migrations) {
    if (override !== Database._allow_construction)
      throw Error(`Do not construct a Database directly; use Database.new.`);

    this.migrations = migrations;
  }

  static async new<$$ = {}>(name: string, migration_specs: Array<MigrationSpec>): Promise<Database<$$>> {
    const migrations = new Migrations(migration_specs);
    const db = new Database<$$>(Database._allow_construction, migrations);

    const old_version = await getDbVersion(name);
    db.structure = migrations.calcStructure(name, old_version);
    await migrations.upgrade(db, old_version);

    return db;
  }

  async _withShorthand(): Promise<$$ & this> {
    const conn = new AutonomousConnection(this.structure);
    for (const store_name of this.structure.store_names) {
      const store_structure = some(this.structure.store_structures[store_name]);
      const store = new AutonomousStore(store_structure, conn);
      (this as any)['$' + store_name] = store._withShorthand();
    }
    const $$this = this as any as $$ & this;
    this._withShorthand = () => Promise.resolve($$this);
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

  async newConnection(): Promise<$$ & BoundConnection<$$>> {
    const idb_conn = await this._newIdbConn();
    const conn = new BoundConnection<$$>(this.structure, idb_conn);
    return conn._withShorthand();
  }

  async connect<T>(callback: (conn: $$ & BoundConnection<$$>) => Promise<T>): Promise<T> {
    const conn = await this.newConnection();
    const result = await callback(conn);
    conn.close();
    return result;
  }

  _versionChange(version: number, new_structure: DatabaseStructure, upgrade: (tx: Transaction) => void): Promise<void> {
    /* Asynchronously re-open the underlying idb database with the given
    version number, if supplied. If an upgrade function is given, it will be
    attached to the upgradeneeded event of the database open request. */

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.structure.name, version);
      req.onupgradeneeded = _event => {
        const idb_tx = some(req.transaction);
        new Transaction<$$>(idb_tx, this.structure).wrapSynchronous(tx => upgrade(tx));
      };
      req.onsuccess = _event => {
        this.structure = new_structure;
        const idb_db = req.result;
        idb_db.close();
        resolve();
      };
      req.onerror = _event => {
        reject(req.error);
      };
    });
  }

  async destroy(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(this.structure.name);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

}
