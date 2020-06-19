
import { Row } from './row';
import { Index } from './index';
import { Storable } from './storable';
import { mapError } from './errors';
import { AsyncCont } from './cont';
import { some, Dict } from './util';
import { StorableRegistry } from './storable';
import { Selection, Cursor } from './query';
import { StoreStructure, IndexStructure } from './structure';
import { Indexable, IndexableRegistry, NativelyIndexable } from './indexable';

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
   * Store name.
   * Unique per-[[Database]].
   */
  name: string;

  /**
   * Store [[Index]]es.
   */
  indexes: Dict<Index<Item, Indexable>>;

  /**
   * An alias for [[Store.indexes]].
   *
   * The type is `unknown` because the type should be given by the user-defined `$$` type.
   *
   * See {@page Example}.
   */
  by: unknown;

  _idb_store_k: AsyncCont<IDBObjectStore>;
  _substructures: Dict<IndexStructure<Item>>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    idb_store_k: AsyncCont<IDBObjectStore>;
    structure: StoreStructure;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this._idb_store_k = args.idb_store_k;
    this._substructures = args.structure.indexes;
    this._storables = args.storables;
    this._indexables = args.indexables;

    this.name = args.structure.name;

    this.indexes = {};
    for (const index_name of Object.keys(this._substructures)) {
      this.indexes[index_name] = new Index({
        idb_index_k: this._idb_store_k.map(idb_store => idb_store.index(index_name)),
        name: index_name,
        structure: some(this._substructures[index_name]),
        sibling_structures: this._substructures,
        storables: this._storables,
        indexables: this._indexables,
      });
    }

    this.by = this.indexes as Record<string, Index<Item, Indexable>>;
  }

  async _mapExistingRows(mapper: (row: Row) => Row): Promise<void> {
    await this._idb_store_k.run(async idb_store => {
      const cursor = new Cursor({
        idb_source: idb_store,
        index_structures: this._substructures,
        query: 'everything',
        storables: this._storables,
        indexables: this._indexables,
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
    return await this._idb_store_k.run(idb_store => {
      return new Promise((resolve, reject) => {
        // Don't include the id since it's autoincrement'd
        const row: Omit<Row, 'id'> = {
          payload: this._storables.encode(item),
          traits: this._calcTraits(item),
        };

        const req = idb_store.add(row);
        req.onsuccess = _event => resolve();
        req.onerror = _event => reject(mapError(req.error));
      });
    });
  }

  _calcTraits(item: Item): Dict<NativelyIndexable> {
    /* Calculate all indexed traits for an item */
    const traits: Dict<NativelyIndexable> = {};
    for (const index_name of Object.keys(this._substructures)) {
      const index_structure = some(this._substructures[index_name]);
      const trait = index_structure.calc_trait(item);
      const encoded = this._indexables.encode(trait, index_structure.explode);
      const trait_name = index_name;
      traits[trait_name] = encoded;
    }
    return traits;
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
    return await this._idb_store_k.run(idb_store => {
      return new Promise((resolve, reject) => {
        const req = idb_store.getAll();
        req.onsuccess = (event) => {
          const rows = (event.target as any).result as Array<Row>;
          const items = rows.map(row => this._storables.decode(row.payload) as Item);
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
      index_structures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
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

    // We're gonna cheat a little bit :^)
    if (!this._idb_store_k.trivial)
      throw Error('Cannot call .addIndex on a Store with a nontrivial continuation');
    const idb_store = await this._idb_store_k.value;

    if (typeof trait_path_or_getter === 'string') {
      const trait_path = trait_path_or_getter;
      if (!trait_path.startsWith('.'))
        throw Error("Trait path must start with '.'");
      trait_path_or_getter = trait_path.slice(1);
    }

    const unique = options?.unique ?? false;
    const explode = options?.explode ?? false;

    const idb_index =
      // eslint-disable-next-line no-constant-condition
      'this._tx.genuine' // TODO
        ? idb_store.createIndex(index_name, `traits.${index_name}`, { unique, multiEntry: explode })
        : idb_store.index(index_name)
        ;

    const index_structure = new IndexStructure({
      name: index_name,
      trait_path_or_getter: trait_path_or_getter,
      unique: unique,
      explode: explode,
    });

    // update existing items if needed
    if (index_structure.kind === 'derived') {
      const trait_getter = some(index_structure.getter);
      await this.all()._replaceRows((row: Row) => {
        const item = this._storables.decode(row.payload) as Item;
        row.traits[index_name] = this._indexables.encode(trait_getter(item), explode);
        return row;
      });
    }

    const index = new Index<Item, Trait>({
      idb_index_k: AsyncCont.fromValue(idb_index),
      name: index_name,
      structure: index_structure,
      sibling_structures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
    });

    this._substructures[index_name] = index_structure;
    this.indexes[index_name] = index;

    return index;

  }

  /**
   * Remove an index from the store
   *
   * Only possible in a `versionchange` transaction, which is given by [[Database.upgrade]].
   *
   * @param name The name of the index to remove.
   */
  async removeIndex(name: string): Promise<void> {

    // eslint-disable-next-line no-constant-condition
    if ('this._tx.genuine') {  // TODO

      // remove idb index
      await this._idb_store_k.run(idb_store => idb_store.deleteIndex(name));

      // update existing rows if needed
      if (some(this.indexes[name]).kind === 'derived') {
        await this.all()._replaceRows((row: Row) => {
          delete row.traits[name];
          return row;
        });
      }

    }

    // remove index from this object
    delete this._substructures[name];
    delete this.indexes[name];

  }

}

