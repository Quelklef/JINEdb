
import { some } from './util';
import { Storable } from './storable';
import { Indexable } from './indexable';
import { AutonomousStore } from './store';
import { TransactionMode } from './transaction';
import { query, queryUnique, QuerySpec, QueryExecutor, UniqueQueryExecutor } from './query';

/**
 * Structure of an index
 * @typeParam Item The type of objects stored in the [[Store]] that this index exists on.
 * @typeParam Trait The type of traits that this index tracks.
 */
export class IndexStructure<Item extends Storable, Trait extends Indexable> {

  /**
   * Name of the index. Index names are unique for a particular store.
   */
  name: string;

  /**
   * Can two stored objects have the same value for this index?
   */
  unique: boolean;

  /**
   * If `explode` is true, then this index can have multiple values for each item.
   * An index that `explode`s expects an array as its value.
   * Each item in this array will be added to the index for the particular object.
   *
   * For example, a blog might store posts. Posts may have tags. If there is an index
   * for tags and it `explode`s, then a post will get several entries in the tag index:
   * one for each tag. So a post with tags `"programming"` and `"javascript"` will show
   * up for a query for `"programming"` and a query for `"javascript"`.
   */
  explode: boolean;

  parent_store_name: string;
  trait_path_or_getter: string | ((item: Item) => Trait);

  constructor(args: {
    name: string;
    unique: boolean;
    explode: boolean;
    parent_store_name: string;
    trait_path_or_getter: string | ((item: Item) => Trait);
  }) {
    this.name = args.name;
    this.unique = args.unique;
    this.explode = args.explode;
    this.parent_store_name = args.parent_store_name;
    this.trait_path_or_getter = args.trait_path_or_getter;
  }

  /**
   * The kind of the index.
   *
   * Indexes can either be 'path' indexes or 'derived' indexes.
   * A 'path' index indexes attributes of stored objects.
   * A 'derived' index indexes functions of stored objects.
   */
  get kind(): 'path' | 'derived' {
    if (typeof this.trait_path_or_getter === 'string')
      return 'path';
    return 'derived';
  }

  /**
   * If this index is a path index, returns the attribute path.
   * Otherwise, throws.
   */
  get trait_path(): string {
    if (this.kind !== 'path')
      throw Error('Cannot get .path on a non-path index.');
    return this.trait_path_or_getter as string;
  }

  /**
   * If this index is a derived index, returns the trait getter.
   * Otherwise, throws.
   */
  get trait_getter(): (item: Item) => Trait {
    if (this.kind !== 'derived')
      throw Error('Cannot get .trait_getter on a non-derived index.');
    return this.trait_path_or_getter as (item: Item) => Trait;
  }

}

/**
 * Generic interface for indexes.
 *
 * An index is a way of organizing stored items to be queried later.
 *
 * Indexes keep track of so-called 'traits' of your items; you may then
 * query the index to find items with a particular trait or within a certain
 * range of traits.
 */
export interface Index<Item extends Storable, Trait extends Indexable> {

  /**
   * Index structure
   */
  readonly structure: IndexStructure<Item, Trait>;

  /**
   * Get an item by trait.
   * Usable on unique indexes only.
   * Throws if no item is found.
   * @returns The found item.
   */
  get(trait: Trait): Promise<Item>;

  /**
   * Find all items matching a given trait.
   * @returns The found items.
   */
  find(trait: Trait): Promise<Array<Item>>;

  /**
   * Select a single item by trait.
   * Usable on unique indexes only.
   */
  one(trait: Trait): UniqueQueryExecutor<Item, Trait>;

  /**
   * Select several items by a range of traits.
   */
  range(spec: QuerySpec): QueryExecutor<Item, Trait>;

  _transact<T>(mode: TransactionMode, callback: (index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T>;

}

/**
 * An index that is bound to a particular transaction
 */
export class BoundIndex<Item extends Storable, Trait extends Indexable> implements Index<Item, Trait> {

  /** @inheritDoc */
  readonly structure: IndexStructure<Item, Trait>

  readonly _idb_index: IDBIndex;

  constructor(structure: IndexStructure<Item, Trait>, idb_index: IDBIndex) {
    this.structure = structure;
    this._idb_index = idb_index;
  }

  _get_trait(item: Item): Trait {
    if (this.structure.kind === 'path') {
      return (item as any)[this.structure.trait_path];
    } else {
      return this.structure.trait_getter(item);
    }
  }

  /** @inheritDoc */
  one(trait: Trait): UniqueQueryExecutor<Item, Trait> {
    return queryUnique(this, { equals: trait });
  }

  /** @inheritDoc */
  range(query_spec: QuerySpec): QueryExecutor<Item, Trait> {
    return query(this, query_spec);
  }

  /** @inheritDoc */
  async get(trait: Trait): Promise<Item> {
    return await this.one(trait).get();
  }

  /** @inheritDoc */
  async find(trait: Trait): Promise<Array<Item>> {
    return await this.range({ equals: trait }).array();
  }

  async _transact<T>(mode: TransactionMode, callback: (index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T> {
    return await callback(this);
  }

}

/**
 * An index that will create its own transaction on each method call
 */
export class AutonomousIndex<Item extends Storable, Trait extends Indexable> implements Index<Item, Trait> {

  /** @inheritDoc */
  readonly structure: IndexStructure<Item, Trait>

  readonly _parent: AutonomousStore<Item>;

  constructor(structure: IndexStructure<Item, Trait>, parent: AutonomousStore<Item>) {
    this.structure = structure;
    this._parent = parent;
  }

  async _transact<T>(mode: TransactionMode, callback: (bound_index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T> {
    return this._parent._transact(mode, async bound_store => {
      const bound_index = some(bound_store.indexes[this.structure.name]) as BoundIndex<Item, Trait>;
      return await callback(bound_index);
    });
  }

  /** @inheritDoc */
  one(trait: Trait): UniqueQueryExecutor<Item, Trait> {
    return queryUnique(this, { equals: trait });
  }

  /** @inheritDoc */
  range(spec: QuerySpec): QueryExecutor<Item, Trait> {
    return query(this, spec);
  }

  /** @inheritDoc */
  async get(trait: Trait): Promise<Item> {
    return await this.one(trait).get();
  }

  /** @inheritDoc */
  async find(trait: Trait): Promise<Array<Item>> {
    return await this.range({ equals: trait }).array();
  }

}
