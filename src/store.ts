
import { Row } from './row';
import { Index } from './index';
import { Storable } from './storable';
import { AsyncCont } from './cont';
import { Selection, Cursor } from './query';
import { StoreSchema, IndexSchema } from './schema';
import { Indexable, NativelyIndexable } from './indexable';
import { JineNoSuchIndexError, mapError } from './errors';
import { _try, Dict, Awaitable, Awaitable_map } from './util';

export { StorableRegistry } from './storable';
export { IndexableRegistry } from './indexable';


/**
 * A collection of stored items.
 *
 * A store is a collection of items saved and managed by Jine.
 * Jine can natively handle storing some types (see [[NativelyStorable]]), but not all types.
 * Custom types must be registered. See [[Storable]].
 *
 * @typeparam Item The type of objects contained in this store.
 */
export class Store<Item extends Storable> {

  /**
   * An alias for [[Store.indexes]].
   *
   * The type is `unknown` because the type should be given by the user-defined `$$` type.
   *
   * See {@page Example}.
   */
  by: unknown;

  /**
   * Store name
   *
   * Unique per-database
   */
  get name(): Awaitable<string> {
    return Awaitable_map(this._schema_g(), schema => schema.name);
  }

  _idb_store_k: AsyncCont<IDBObjectStore>;
  _schema_g: () => Awaitable<StoreSchema<Item>>;

  constructor(args: {
    idb_store_k: AsyncCont<IDBObjectStore>;
    schema_g: () => Awaitable<StoreSchema<Item>>;
  }) {
    this._idb_store_k = args.idb_store_k;
    this._schema_g = args.schema_g;

    this.by = new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const index_name = prop;
          const idb_index_k = this._idb_store_k.map(
            idb_store =>
              _try(
                () => idb_store.index(index_name),
                err => err.name === 'NotFoundError' && new JineNoSuchIndexError(`No index named '${index_name}'.`)));
          return new Index({
            idb_index_k: idb_index_k,
            schema_g: async () => (await this._schema_g()).index(index_name),
            parent: this,
          });
        }
      }
    });
  }

  async _mapExistingRows(mapper: (row: Row) => Row): Promise<void> {
    return await this._idb_store_k.run(async idb_store => {
      const cursor = new Cursor({
        idb_source: idb_store,
        query: 'everything',
        store_schema: await this._schema_g(),
      });
      for (await cursor.init(); cursor.active; await cursor.step()) {
        await cursor._replaceRow(mapper(cursor._currentRow()));
      }
    });
  }

  /**
   * Add an item to the store.
   */
  async add(item: Item): Promise<void> {
    return this._idb_store_k.run(async idb_store => {
      const schema = await this._schema_g();
      return new Promise((resolve, reject) => {

        const traits: Dict<NativelyIndexable> = {};
        for (const index_name of schema.index_names) {
          const index_schema = schema.index(index_name);
          const trait = index_schema.calc_trait(item);
          const encoded = schema.indexables.encode(trait, index_schema.explode);
          const trait_name = index_name;
          traits[trait_name] = encoded;
        }

        // Don't include the id since it's autoincrement'd
        const row: Omit<Row, 'id'> = {
          payload: schema.storables.encode(item),
          traits: traits,
        };

        const req = idb_store.add(row);
        req.onsuccess = _event => resolve();
        req.onerror = _event => reject(mapError(req.error));

      });
    });
  }

  /**
   * Remove all items from the store.
   */
  async clear(): Promise<void> {
    return await this._idb_store_k.run(idb_store => {
      return new Promise((resolve, reject) => {
        const req = idb_store.clear();
        req.onsuccess = _event => resolve();
        req.onerror = _event => reject(mapError(req.error));
      });
    });
  }

  /**
   * @return The number of items in the store
   */
  async count(): Promise<number> {
    return await this._idb_store_k.run(idb_store => {
      return new Promise((resolve, reject) => {
        const req = idb_store.count();
        req.onsuccess = event => {
          const count = (event.target as any).result as number;
          resolve(count);
        };
        req.onerror = _event => reject(mapError(req.error));
      });
    });
  }

  /**
   * @returns An array with all items in the store.
   */
  async array(): Promise<Array<Item>> {
    return this._idb_store_k.run(async idb_store => {
      const schema = await this._schema_g();
      return new Promise((resolve, reject) => {
        const req = idb_store.getAll();
        req.onsuccess = (event) => {
          const rows = (event.target as any).result as Array<Row>;
          const items = rows.map(row => schema.storables.decode(row.payload) as Item);
          resolve(items);
        };
        req.onerror = _event => reject(mapError(req.error));
      });
    });
  }

  /**
   * Begin a query with all the items in the store
   * @returns The query executor.
   */
  all(): Selection<Item, never> {
    return new Selection({
      source: this,
      query: 'everything',
      store_schema_g: this._schema_g,
    });
  }

  /**
   * Add an index to the store.
   *
   * Only possible in a `versionchange` transaction, which is given by [[Database.upgrade]].
   *
   * @param index_name The name to give the new index
   * @param trait The path or function that defines the indexed trait (see [[Index]])
   * @param options
   * - `unqiue`: enforces unique values for this trait; see [[Index.unique]].
   * - `explode`: see [[Index.explode]].
   */
  async addIndex<Trait extends Indexable>(
    index_name: string,
    trait_path_or_getter: string | ((item: Item) => Trait),
    options?: { unique?: boolean; explode?: boolean },
  ): Promise<Index<Item, Trait>> {

    return await this._idb_store_k.run(async idb_store => {

      const schema = await this._schema_g();

      if (typeof trait_path_or_getter === 'string') {
        const trait_path = trait_path_or_getter;
        if (!trait_path.startsWith('.'))
          throw Error("Trait path must start with '.'");
        trait_path_or_getter = trait_path.slice(1);
      }

      const unique = options?.unique ?? false;
      const explode = options?.explode ?? false;

      const idb_index = idb_store.createIndex(
        index_name,
        `traits.${index_name}`,
        { unique: unique, multiEntry: explode },
      );

      const index_schema = new IndexSchema({
        name: index_name,
        trait_path_or_getter: trait_path_or_getter,
        unique: unique,
        explode: explode,
        storables: schema.storables,
        indexables: schema.indexables,
      });

      // update existing items if needed
      if (index_schema.kind === 'derived') {
        const trait_getter = index_schema.getter;
        await this.all()._replaceRows((row: Row) => {
          const item = schema.storables.decode(row.payload) as Item;
          row.traits[index_name] = schema.indexables.encode(trait_getter(item), explode);
          return row;
        });
      }

      const index = new Index<Item, Trait>({
        idb_index_k: AsyncCont.fromValue(idb_index),
        schema_g: () => index_schema,
        parent: this,
      });

      schema.addIndex(index_name, index_schema);

      return index;

    });

  }

  /**
   * Remove an index from the store
   *
   * Only possible in a `versionchange` transaction, which is given by [[Database.upgrade]].
   *
   * @param name The name of the index to remove.
   */
  async removeIndex(name: string): Promise<void> {

    return await this._idb_store_k.run(async idb_store => {

      const schema = await this._schema_g();

      // remove idb index
      idb_store.deleteIndex(name);

      // update existing rows if needed
      if (schema.index(name).kind === 'derived') {
        await this.all()._replaceRows((row: Row) => {
          delete row.traits[name];
          return row;
        });
      }

      // remove index from this object
      schema.removeIndex(name);

    });

  }

}

