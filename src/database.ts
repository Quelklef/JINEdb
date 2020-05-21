
import { some } from './util';
import { BoundConnection } from './connection';
import { DatabaseSchema } from './schema';
import { MigrationSpec, Migrations } from './migration';
import { Transaction, withTransactionSynchronous } from './transaction';

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

export class Database<$$> {

  schema!: DatabaseSchema;
  migrations: Migrations;

  static readonly _allow_construction: symbol = Symbol();
  constructor(override: any, migrations: Migrations) {
    if (override !== Database._allow_construction)
      throw Error(`Do not construct a Database directly; use Database.new.`);

    this.migrations = migrations;
  }

  static async new<$$>(name: string, migration_specs: Array<MigrationSpec>): Promise<Database<$$>> {
    const migrations = new Migrations(migration_specs);
    const db = new Database<$$>(Database._allow_construction, migrations);

    const old_version = await getDbVersion(name);
    db.schema = migrations.calcSchema(name, old_version);
    await migrations.upgrade(db, old_version);

    return db;
  }

  async _newIdbConn(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.schema.name, this.schema.version);
      req.onupgradeneeded = _event => reject(Error('Upgrade needed.'));
      req.onsuccess = _event => resolve(req.result);
      req.onerror = _event => reject(req.error);
    });
  }

  async newConnection(): Promise<BoundConnection<$$> & $$> {
    const idb_conn = await this._newIdbConn();
    const conn = new BoundConnection<$$>(this.schema, idb_conn);
    return conn._setUpShorthand();
  }

  async connect<T>(callback: (conn: BoundConnection<$$> & $$) => Promise<T>): Promise<T> {
    const conn = await this.newConnection();
    const result = await callback(conn);
    conn.close();
    return result;
  }

  _versionChange(version: number, new_schema: DatabaseSchema, upgrade: (tx: Transaction<$$>) => void): Promise<void> {
    /* Asynchronously re-open the underlying idb database with the given
    version number, if supplied. If an upgrade function is given, it will be
    attached to the upgradeneeded event of the database open request. */

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.schema.name, version);
      req.onupgradeneeded = _event => {
        const idb_tx = some(req.transaction);
        withTransactionSynchronous(idb_tx, this.schema, upgrade);
      };
      req.onsuccess = _event => {
        this.schema = new_schema;
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
      const req = indexedDB.deleteDatabase(this.schema.name);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

}

