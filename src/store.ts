
import { Row } from './row';
import { Index } from './index';
import { Cursor } from './cursor';
import { Storable } from './storable';
import { some, Dict } from './util';
import { Transaction } from './transaction';
import { StoreSchema, IndexSchema } from './schema';
import { IndexableTrait } from './traits';
import { fullDecode, fullEncode } from './codec';


export class Store<Item extends Storable> {

  public readonly schema: StoreSchema<Item>;
  public readonly indexes: Dict<string, Index<Item, IndexableTrait>>;

  private readonly _get_idb_store: (mode: IDBTransactionMode) => IDBObjectStore;

  constructor(
    schema: StoreSchema<Item>,
    indexes: Dict<string, Index<Item, IndexableTrait>>,
    get_idb_store: (mode: IDBTransactionMode) => IDBObjectStore,
  ) {
    this.schema = schema;
    this.indexes = indexes;

    this._get_idb_store = get_idb_store;

    for (const [index_name, index] of Object.entries(this.indexes)) {
      (this as any)['$' + index_name] = index;
    }
  }

  static bound<Item extends Storable>(schema: StoreSchema<Item>, idb_store: IDBObjectStore): Store<Item> {

    const indexes: Dict<string, Index<Item, IndexableTrait>> = {};
    for (const index_name of Object.keys(schema.index_schemas)) {
      const index_schema = some(schema.index_schemas[index_name]);
      const idb_index = idb_store.index(index_name);
      indexes[index_name] = Index.bound(index_schema, idb_index);
    }

    const get_idb_store = (_mode: IDBTransactionMode): IDBObjectStore => {
      // It's possible that the requested mode is not compatible with the
      // current transaction. We will ignore that here and let it blow up
      // later on.
      return idb_store;
    };

    return new Store(schema, indexes, get_idb_store);

  }

  static autonomous<Item extends Storable>(schema: StoreSchema<Item>, idb_db: IDBDatabase): Store<Item> {
    // TODO: this and Index.autonomous both use transactions that autocommit on
    //       the first unused tick. This is mostly fine, but it's inconsistent with
    //       the rest of the user-facing API where transactions commit ASAP

    const indexes: Dict<string, Index<Item, IndexableTrait>> = {};
    for (const index_name of Object.keys(schema.index_schemas)) {
      const index_schema = some(schema.index_schemas[index_name]);
      indexes[index_name] = Index.autonomous(index_schema, idb_db);
    }

    const get_idb_store = (mode: IDBTransactionMode): IDBObjectStore => {
      const idb_tx = idb_db.transaction([schema.name], mode);
      const idb_store = idb_tx.objectStore(schema.name);
      return idb_store;
    };

    return new Store(schema, indexes, get_idb_store);

  }

  _addIndex<$$>(index_schema: IndexSchema<Item, IndexableTrait>): ((tx: Transaction<$$>) => Promise<void>) | undefined {
    this._get_idb_store('versionchange').createIndex(
      index_schema.name,
      `traits.${index_schema.name}`,
      {
        unique: index_schema.unique,
        multiEntry: index_schema.explode,
      }
    );

    this.schema.index_schemas[index_schema.name] = index_schema;

    if (index_schema.kind === 'path') {
      return undefined;
    } else {
      return async tx => {
        const store = some(tx.stores[this.schema.name]);
        await store._mapExistingRows(row => {
          const item = fullDecode(row.payload, store.schema.item_codec) as Item;
          const index = some(tx.stores[this.schema.name]?.indexes[index_schema.name]);
          const trait = index._get_trait(item);
          row.traits[index_schema.name] = trait;
          row.payload = fullEncode(item, store.schema.item_codec);
          return row;
        });
      };
    }
  }

  _removeIndex<$$>(index_name: string): ((tx: Transaction<$$>) => Promise<void>) | undefined {
    // TODO: This one should also be refactored into two methods, I think
    this._get_idb_store('versionchange').deleteIndex(index_name);
    delete this.schema.index_schemas[index_name];

    const index_schema = some(this.schema.index_schemas[index_name]);
    if (index_schema.kind === 'path') {
      return undefined;
    } else {
      return async tx => {
        const store = some(tx.stores[this.schema.name]);
        await store._mapExistingRows(row => {
          delete row.traits[index_name];
          return row;
        });
      };
    }
  }

  async _mapExistingRows(f: (r: Row) => Row): Promise<void> {
    const cursor_req = this._get_idb_store('readwrite').openCursor();
    const cursor = await Cursor.new(cursor_req, this.schema.item_codec);
    await cursor._replaceAllRows(f);
  }

  async add(item: Item): Promise<void> {
    return new Promise(resolve => {

      // Don't include the id in the added row
      // since it will be automatically assigned by
      // indexedDB
      const row: Omit<Row, 'id'> = {
        payload: fullEncode(item, this.schema.item_codec),
        traits: this._calcTraits(item),
      };

      const req = this._get_idb_store('readwrite').add(row);
      req.onsuccess = _event => resolve();

    });
  }

  _calcTraits(item: Item): Dict<string, IndexableTrait> {
    /* Calculate all indexed traits for an item */
    const traits: Dict<string, IndexableTrait> = {};
    for (const index_name of this.schema.index_names) {
      const index = some(this.indexes[index_name]);
      const trait_name = index_name;
      const trait = index._get_trait(item);
      traits[trait_name] = trait;
    }
    return traits;
  }

  async clear(): Promise<void> {
    return new Promise(resolve => {
      const req = this._get_idb_store('readwrite').clear();
      req.onsuccess = _event => resolve();
    });
  }

  async count(): Promise<number> {
    return new Promise(resolve => {
      const req = this._get_idb_store('readonly').count();
      req.onsuccess = event => {
        const count = (event.target as any).result as number;
        resolve(count);
      };
    });
  }

  async all(): Promise<Array<Item>> {
    return new Promise(resolve => {
      const req = this._get_idb_store('readonly').getAll();
      req.onsuccess = (event) => {
        const rows = (event.target as any).result as Array<Row>;
        const items = rows.map(row => fullDecode(row.payload, this.schema.item_codec));
        resolve(items);
      };
    });
  }

}

