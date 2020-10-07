
import { Store } from './store';
import { PACont } from './cont';
import { Awaitable } from './util';
import { TransactionMode } from './transaction';
import { StoreSchema, IndexSchema } from './schema';
import { Codec, Storable, Indexable } from './codec';
import { Query, Selection, SelectionUnique } from './query';
import { JineError, JineNoSuchIndexError, JineTransactionModeError, mapError } from './errors';


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
export class Index<Item extends Storable, Trait extends Indexable> {

  /** Name of the index. Index names are unique per-[[Store]]. */
  get name(): Awaitable<string> {
    return this._schemaCont.run(schema => schema.name);
  }

  /** Are the values in this index required to be unique? */
  get unique(): Awaitable<boolean> {
    return this._schemaCont.run(schema => schema.unique);
  }

  /**
   * If `explode` is `true`, then items' values for this index are expected to be arrays.
   * Each value in an array will be added to the index, instead of the array being added as a whole.
   *
   * For instance, say we're storing `type User = { id: number, likedPostIds: Array<number> }` objects.
   * We may have an index called `liked` which is intended to organize users by what posts they've liked.
   * If the index is *not* exploding, then the user `{ id: 1, likedPostIds: [1, 2, 3] }` will match
   * a query for `[1, 2, 3]` but not a query for `1`, for `2`, or for `3`.
   * But if the index *is* exploding, then this same user will match a query
   * for each of `1`, `2`, and `3`, but not a query for `[1, 2, 3]`.
   */
  get explode(): Awaitable<boolean> {
    return this._schemaCont.run(schema => schema.explode);
  }

  /**
   * Indexes come in two flavors: path indexes and derived indexes.
   *
   * With a *path index*, items are indexed on existing properties.
   * For example, if we're storing array objects, we may index by `.length`.
   * The path is stored in [[Index.traitPath]].
   *
   * With a *derived index*, items are indexed on calculated values.
   * For example, storing an array object, we may want to index by whether or not the array has a duplicate value.
   * Then we would index by the function `(item: Array) => item.length !== new Set(item).size` (or a more efficient alternative).
   * This function is stored in [[Index.traitGetter]].
   */
  get kind(): Awaitable<'path' | 'derived'> {
    return this._schemaCont.run(schema => schema.kind);
  }

  /** If `this.kind === 'path'`, return the trait path. */
  get traitPath(): Awaitable<undefined | string> {
    return this._schemaCont.run(schema => schema.path);
  }

  /** If `this.kind === 'derived'`, return the trait computing function. */
  get traitGetter(): Awaitable<undefined | ((item: Item) => Trait)> {
    return this._schemaCont.run(schema => schema.getter);
  }

  private readonly _parentStore: Store<Item>;
  private readonly _parentStoreSchemaCont: PACont<StoreSchema<Item>>;
  private readonly _idbIndexCont: PACont<IDBIndex, TransactionMode>;
  private readonly _assertTxModeCont: PACont<void, TransactionMode>;
  private readonly _schemaCont: PACont<IndexSchema<Item, Trait>>;
  private readonly _codec: Codec;

  constructor(args: {
    parentStore: Store<Item>;
    parentStoreSchemaCont: PACont<StoreSchema<Item>>;
    parentIdbStoreCont: PACont<IDBObjectStore, TransactionMode>;
    schemaCont: PACont<IndexSchema<Item, Trait>>;
    codec: Codec;
  }) {
    this._parentStore = args.parentStore;
    this._parentStoreSchemaCont = args.parentStoreSchemaCont;
    this._schemaCont = args.schemaCont;
    this._codec = args.codec;

    // vv .run with the required transaction mode; will fail upstream
    // if the parentIdbStoreCont cannot support it
    this._assertTxModeCont = args.parentIdbStoreCont.map((): void => { });

    this._idbIndexCont = PACont.pair(args.parentIdbStoreCont, this._schemaCont).map(([idbStore, schema]) => {
      const indexName = schema.name;

      // vv Indexes are not available during migrations, since they use the codec, which
      //    is not available to migrations.
      if (idbStore.transaction.mode === 'versionchange')
        throw new JineTransactionModeError(`Indexes are not available during migrations.`);

      try {
        return idbStore.index(indexName);
      } catch (err) {
        if (err.name === 'NotFoundError')
          throw new JineNoSuchIndexError({ indexName });
        throw mapError(err);
      }
    });
  }

  /**
   * Updates the trait getter on a derived index.
   *
   * Only usable during a migration.
   */
  async updateTraitGetter(newGetter: (item: Item) => Trait): Promise<void> {
    await this._assertTxModeCont.run('m', () => { });
    if (this.kind !== 'derived')
      throw new JineError(`I was asked to update a trait getter on a non-derived index. I can't do this!`);
    await this._schemaCont.run(schema => schema.getter = newGetter);
  }

  /**
  * Updates the trait path on a path index.
  *
  * Only usable during a migration.
  */
  async updateTraitPath(newPath: string): Promise<void> {
    await this._assertTxModeCont.run('m', () => { });
    if (this.kind === 'derived')
      throw new JineError(`I was asked to update a trait path on a derived index. I can't do this!`);
    if (!newPath.startsWith('.'))
      throw new JineError("Trait path must start with '.'");
    await this._schemaCont.run(schema => schema.path = newPath.slice(1));
  }

  /** Test if there are any items with the given trait */
  async exists(trait: Trait): Promise<boolean> {
    return !(await this.select({ equals: trait }).isEmpty());
  }

  /**
   * Retrieve all items matching a given trait.
   */
  async get(trait: Trait): Promise<Array<Item>> {
    return await this.select({ equals: trait }).array();
  }

  /**
   * Get an item by trait.
   *
   * Usable on unique indexes only.
   *
   * Throws if no item is found.
   */
  async getOne(trait: Trait): Promise<Item> {
    return await this.selectOne(trait).get();
  }

  /**
   * Update an item if it exists, or add a new one if it doesn't.
   *
   * Allowed on unique indexes only.
   */
  async updateOrAdd(item: Item): Promise<void> {
    await this._schemaCont.run(async schema => {
      if (!schema.unique)
        throw new JineError(`Cannot call Index#updateOrAdd on non-unique index '${schema.name}'.`);

      const trait = schema.calcTrait(item);
      const alreadyExists = await this.exists(trait);
      if (alreadyExists) {
        await this.selectOne(trait).update(item);
      } else {
        await this._parentStore.add(item);
      }
    });
  }

  /**
   * Get an item by trait, or return something else if the item isn't found.
   *
   * Usable on unique indexes only.
   */
  async getOneOr<T = undefined>(trait: Trait, alternative: T): Promise<Item | T> {
    return await this.selectOne(trait).getOr(alternative);
  }

  /** Select several items by a range of traits. */
  select(query: Query<Trait>): Selection<Item, Trait> {
    return new Selection({
      query: query,
      idbSourceCont: this._idbIndexCont,
      storeSchemaCont: this._parentStoreSchemaCont,
      codec: this._codec,
    });
  }

  /**
   * Select a single item by trait.
   *
   * Usable on unique indexes only.
   */
  selectOne(trait: Trait): SelectionUnique<Item, Trait> {
    return new SelectionUnique({
      selectedTrait: trait,
      idbSourceCont: this._idbIndexCont,
      storeSchemaCont: this._parentStoreSchemaCont,
      codec: this._codec,
    });
  }

}

