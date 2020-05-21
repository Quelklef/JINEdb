
import { Store } from './store';
import { DatabaseSchema } from './schema';
import { MigrationSpec, Migrations } from './migration';
import { Transaction, withTransaction, TransactionMode, uglifyTransactionMode } from './transaction';

export class Database<$$> {

  schema: DatabaseSchema;
  migrations: Migrations;

  _idb_db!: IDBDatabase;

  static readonly _allow_construction: symbol = Symbol();
  constructor(override: any, name: string, migrations: Migrations) {
    if (override !== Database._allow_construction)
      throw Error('Do not construct a Jine directly; use Jine.new');

    this.migrations = migrations;
    this.schema = migrations.calcSchema(name);
  }

  static async new<$$>(name: string, migration_specs: Array<MigrationSpec>): Promise<Database<$$>> {
    const migrations = new Migrations(migration_specs);

    const db = new Database<$$>(Database._allow_construction, name, migrations);

    const old_version = await db._getVersion();
    await migrations.upgrade(db, old_version);

    return db;
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

  // Stores really has type Array<Store<? extends Storable>>, but TypeScript
  // doesn't support existential types at the moment :(
  // Apparently they can be emulated. This would be nice, as a massive amount
  // of this codebase has existential types hidden around it.
  // TODO: try emulating existential types.
  async transact(stores: Array<Store<any>>, mode: TransactionMode, callback: (tx: Transaction<$$>) => Promise<void>): Promise<void> {
    const store_names = stores.map(store => store.schema.name);
    const idb_tx = this._idb_db.transaction(store_names, uglifyTransactionMode(mode));
    await withTransaction(idb_tx, this.schema, callback);
  }

  async destroy(): Promise<void> {
    return new Promise(resolve => {
      const req = indexedDB.deleteDatabase(this.schema.name);
      req.onsuccess = _event => resolve();
    });
  }

}








