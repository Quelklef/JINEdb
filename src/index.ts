
import { Store } from './store';
import { Awaitable } from './util';
import { AsyncCont } from './cont';
import { JineError } from './errors';
import { IndexSchema } from './schema';
import { Query, Selection, SelectionUnique } from './query';


/**
 * An index on an object store.
 *
 * An index is a way of organizing stored items to be queried later.
 * You set up an index to keep track of particular attributes of your
 * items (such as a `.id` property). The attribute that you track is known
 * as the *trait*. You can then query indexes to find items based on
 * their traits.
 *
 * @typeparam Item The type of the item stored on the [[Store]] that this indexes is connected to.
 * @typeparam Trait The type of the traits being indexed by.
 */
export class Index<Item, Trait> {

  /**
   * Name of the index.
   * Index names are unique for a particular store.
   */
  get name(): Awaitable<string> {
    return this._schema_k.run(schema => schema.name);
  }

  /**
   * Are the values in this index required to be unique?
   */
  get unique(): Awaitable<boolean> {
    return this._schema_k.run(schema => schema.unique);
  }

  /**
   * If `explode` is `true`, then items' values for this index are expected to be arrays.
   * Each value in an array will be added to the index, instead of the array being added as a whole.
   *
   * For instance, say we're storing `type User = { id: number, liked_post_ids: Array<number> }` objects.
   * We may have an index called `liked` which is intended to organize users by what posts they've liked.
   * If the index is *not* exploding, then the user `{ id: 1, liked_post_ids: [1, 2, 3] }` will match
   * a query for `[1, 2, 3]` but not a query for `1`, for `2`, or for `3`.
   * But if the index *is* exploding, then this same user will match a query
   * for each of `1`, `2`, and `3`, but not a query for `[1, 2, 3]`.
   */
  get explode(): Awaitable<boolean> {
    return this._schema_k.run(schema => schema.explode);
  }

  /**
   * Indexes come in two flavors: path indexes and derived indexes.
   *
   * With a *path index*, items are indexed on existing properties.
   * For example, if we're storing array objects, we may index by `.length`.
   * The path is stored in [[Index.trait_path]].
   *
   * With a *derived index*, items are indexed on calculated values.
   * For example, storing an array object, we may want to index by whether or not the array has a duplicate value.
   * Then we would index by the function `(item: Array) => item.length !== new Set(item).size` (or a more efficient alternative).
   * This function is stored in [[Index.trait_getter]].
   */
  get kind(): Awaitable<'path' | 'derived'> {
    return this._schema_k.run(schema => schema.kind);
  }

  /**
   * If `this.kind === 'path'`, return the trait path.
   */
  get trait_path(): Awaitable<undefined | string> {
    return this._schema_k.run(schema => schema.path);
  }

  /**
   * If `this.kind === 'derived'`, return the trait computing function.
   */
  get trait_getter(): Awaitable<undefined | ((item: Item) => Trait)> {
    return this._schema_k.run(schema => schema.getter);
  }


  _idb_index_k: AsyncCont<IDBIndex>;
  _schema_k: AsyncCont<IndexSchema<Item, Trait>>;
  _parent: Store<Item>;

  constructor(args: {
    idb_index_k: AsyncCont<IDBIndex>;
    schema_k: AsyncCont<IndexSchema<Item, Trait>>;
    parent: Store<Item>;
  }) {
    this._idb_index_k = args.idb_index_k;
    this._schema_k = args.schema_k;
    this._parent = args.parent;
  }

  /**
   * Test if there are any items with the given trait
   */
  async exists(trait: Trait): Promise<boolean> {
    return !(await this.select({ equals: trait }).isEmpty());
  }

  /**
   * Retrieve all items matching a given trait.
   * @param trait The trait to look for
   * @returns The found items.
   */
  async get(trait: Trait): Promise<Array<Item>> {
    return await this.select({ equals: trait }).array();
  }

  /**
   * Get an item by trait.
   * Usable on unique indexes only.
   * Throws if no item is found.
   * @param trait The trait to look for
   * @returns The found item.
   */
  async getOne(trait: Trait): Promise<Item> {
    return await this.selectOne(trait).get();
  }

  /**
   * Update an item if it exists, or add a new one if it doesn't.
   *
   * Allowed on unique indexes only.
   *
   * @param item The item
   */
  async updateOrAdd(item: Item): Promise<void> {
    await this._schema_k.run(async schema => {
      if (!schema.unique)
        throw new JineError(`Cannot call Index#updateOrAdd on non-unique index '${schema.name}'.`);
      const trait = schema.calc_trait(item);
      const already_exists = await this.exists(trait);
      if (already_exists) {
        await this.selectOne(trait).update(item);
      } else {
        await this._parent.add(item);
      }
    });
  }

  /**
   * Get an item by trait, or return something else if the item isn't found.
   * Usable on unique indexes only.
   * @param trait The trait to look for
   * @param alternative The value to return on failure
   * @returns The found item, or alternative value.
   */
  async getOneOr<T = undefined>(trait: Trait, alternative: T): Promise<Item | T> {
    return await this.selectOne(trait).getOr(alternative);
  }

  /**
   * Select several items by a range of traits.
   */
  select(query: Query<Trait>): Selection<Item, Trait> {
    return new Selection({
      source: this,
      query: query,
      store_schema_k: this._parent._schema_k,
    });
  }

  /**
   * Select a single item by trait.
   * Usable on unique indexes only.
   */
  selectOne(trait: Trait): SelectionUnique<Item, Trait> {
    return new SelectionUnique({
      source: this,
      selected_trait: trait,
      store_schema_k: this._parent._schema_k,
    });
  }

}

