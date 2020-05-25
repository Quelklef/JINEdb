
import { some } from './util';
import { Storable } from './storable';
import { IndexableTrait } from './traits';
import { AutonomousStore } from './store';
import { TransactionMode } from './transaction';
import { ItemCodec } from './codec';
import { query, queryUnique, QuerySpec, QueryExecutor, UniqueQueryExecutor } from './query';

export class IndexStructure<Item extends Storable, Trait extends IndexableTrait> {

  public name: string;
  public unique: boolean;
  public explode: boolean;
  public item_codec: ItemCodec<Item>;
  public parent_store_name: string;
  public trait_path_or_getter: string | ((item: Item) => Trait);

  constructor(args: {
    name: string;
    unique?: boolean;
    explode?: boolean;
    item_codec: ItemCodec<Item>;
    parent_store_name: string;
    trait_path_or_getter: string | ((item: Item) => Trait);
  }) {
    this.name = args.name;
    this.unique = args.unique ?? false;
    this.explode = args.explode ?? false;
    this.item_codec = args.item_codec;
    this.parent_store_name = args.parent_store_name;
    this.trait_path_or_getter = args.trait_path_or_getter;
  }

  get kind(): 'path' | 'derived' {
    if (typeof this.trait_path_or_getter === 'string')
      return 'path';
    return 'derived';
  }

  get trait_path(): string {
    if (this.kind !== 'path')
      throw Error('Cannot get .path on a non-path index.');
    return this.trait_path_or_getter as string;
  }

  get trait_getter(): (item: Item) => Trait {
    if (this.kind !== 'derived')
      throw Error('Cannot get .trait_getter on a non-derived index.');
    return this.trait_path_or_getter as (item: Item) => Trait;
  }

}

export interface Index<Item extends Storable, Trait extends IndexableTrait> {

  // TODO: Structure types should probably be in respective files, not together in structure.ts
  readonly structure: IndexStructure<Item, Trait>;

  get(trait: Trait): Promise<Item>;
  find(trait: Trait): Promise<Array<Item>>;

  one(trait: Trait): UniqueQueryExecutor<Item, Trait>;
  range(spec: QuerySpec): QueryExecutor<Item, Trait>;
  all(): QueryExecutor<Item, Trait>;

  _transact<T>(mode: TransactionMode, callback: (index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T>;

}

export class BoundIndex<Item extends Storable, Trait extends IndexableTrait> implements Index<Item, Trait> {

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

  one(trait: Trait): UniqueQueryExecutor<Item, Trait> {
    return queryUnique(this, { equals: trait });
  }

  range(query_spec: QuerySpec): QueryExecutor<Item, Trait> {
    return query(this, query_spec);
  }

  all(): QueryExecutor<Item, Trait> {
    return this.range(null);
  }

  async get(trait: Trait): Promise<Item> {
    return await this.one(trait).get();
  }

  async find(trait: Trait): Promise<Array<Item>> {
    return await this.range({ equals: trait }).array();
  }

  async _transact<T>(mode: TransactionMode, callback: (index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T> {
    return await callback(this);
  }

}

export class AutonomousIndex<Item extends Storable, Trait extends IndexableTrait> implements Index<Item, Trait> {

  public readonly structure: IndexStructure<Item, Trait>

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

  one(trait: Trait): UniqueQueryExecutor<Item, Trait> {
    return queryUnique(this, { equals: trait });
  }

  range(spec: QuerySpec): QueryExecutor<Item, Trait> {
    return query(this, spec);
  }

  all(): QueryExecutor<Item, Trait> {
    return this.range(null);
  }

  async get(trait: Trait): Promise<Item> {
    return await this.one(trait).get();
  }

  async find(trait: Trait): Promise<Array<Item>> {
    return await this.range({ equals: trait }).array();
  }

}
