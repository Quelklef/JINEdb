
import { JineSchema } from './schema';
import { Transaction } from './transaction';
import { setUpShorthand } from './shorthand';
import { MigrationSpec, Migrations } from './migration';

export class Jine<$$> {

  schema: JineSchema;
  migrations: Migrations;

  _idb_db!: IDBDatabase;

  static readonly _allow_construction: symbol = Symbol();
  constructor(override: any, name: string, migrations: Migrations) {
    if (override !== Jine._allow_construction)
      throw Error('Do not construct a Jine directly; use Jine.new');

    this.migrations = migrations;
    this.schema = migrations.calcSchema(name);
  }

  static async new<$$>(name: string, migration_specs: Array<MigrationSpec>): Promise<Jine<$$> & $$> {
    const migrations = new Migrations(migration_specs);

    const jine = new Jine<$$>(Jine._allow_construction, name, migrations);

    const old_version = await jine._getVersion();
    await migrations.upgrade(jine, old_version);

    return setUpShorthand(jine, jine._idb_db);
  }

  async _getVersion(): Promise<number> {
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

    if (!database_names.includes(this.schema.name)) {
      return 0;
    } else {
      return await new Promise(resolve => {
        const req = indexedDB.open(this.schema.name);
        req.onsuccess = event => {
          const idb_db = (event.target as any).result;
          const version = idb_db.version;
          idb_db.close();
          resolve(version);
        }
      });
    }
  }

  _openIdbDb(version?: number, upgrade?: (event: Event) => void): Promise<void> {
    /* Asynchronously re-open the underlying idb database with the given
    version number, if supplied. If an upgrade function is given, it will be
    attached to the upgradeneeded event of the database open request. */

    return new Promise(resolve => {
      const req = indexedDB.open(this.schema.name, version);
      req.onsuccess = event => {
        this._idb_db = (event.target as any).result;
        resolve();
      }
      if (upgrade !== undefined) {
        req.onupgradeneeded = upgrade;
      }
    });
  }

  async transact(store_names: Array<string>, mode: IDBTransactionMode, callback: (tx: Transaction & $$) => Promise<void>): Promise<void> {
    const idb_tx = this._idb_db.transaction(store_names, mode);
    const tx = new Transaction(idb_tx, this.schema);
    await callback(tx as Transaction & $$);
    // TODO: if the callback also commits the transaction, will double-committing it throw?
    tx.commit();
  }

  async destroy(): Promise<void> {
    return new Promise(resolve => {
      const req = indexedDB.deleteDatabase(this.schema.name);
      req.onsuccess = _event => resolve();
    });
  }

}








