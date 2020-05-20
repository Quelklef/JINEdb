
import { Dict } from './util';
import { Storable } from './storable';
import { ItemCodec } from './codec';
import { IndexableTrait } from './traits';

export class DatabaseSchema {

  public name: string;
  public store_schemas: Dict<string, StoreSchema<Storable>>;

  constructor(args: {
    name: string;
    store_schemas: Dict<string, StoreSchema<Storable>>;
  }) {
    this.name = name;
    this.store_schemas = args.store_schemas;
  }

  get store_names(): Set<string> {
    return new Set(Object.keys(this.store_schemas));
  }

}

export class StoreSchema<Item extends Storable = Storable> {

  public name: string;
  public item_codec: ItemCodec<Item>;
  public index_schemas: Dict<string, IndexSchema<Item, IndexableTrait>>;

  constructor(args: {
    name: string;
    item_codec: ItemCodec<Item>;
    index_schemas: Dict<string, IndexSchema<Item, IndexableTrait>>;
  }) {
    this.name = args.name;
    this.item_codec = args.item_codec;
    this.index_schemas = args.index_schemas;
  }

  get index_names(): Set<string> {
    return new Set(Object.keys(this.index_schemas));
  }

}

export class IndexSchema<Item extends Storable, Trait extends IndexableTrait> {

  public name: string;
  public unique: boolean;
  public explode: boolean;
  public item_codec: ItemCodec<Item>;
  public parent_store_name: string;
  public trait_path_or_getter: string | ((item: Item) => Trait);

  constructor(args: {
    name: string;
    unique: boolean;
    explode: boolean;
    item_codec: ItemCodec<Item>;
    parent_store_name: string;
    trait_path_or_getter: string | ((item: Item) => Trait);
  }) {
    this.name = args.name;
    this.unique = args.unique;
    this.explode = args.explode;
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
