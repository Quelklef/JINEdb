
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
  public trait_getter: (item: Item) => Trait;
  public parent_store_name: string;

  constructor(args: {
    name: string;
    unique: boolean;
    explode: boolean;
    item_codec: ItemCodec<Item>;
    trait_getter: (item: Item) => Trait;
    parent_store_name: string;
  }) {
    this.name = args.name;
    this.unique = args.unique;
    this.explode = args.explode;
    this.item_codec = args.item_codec;
    this.trait_getter = args.trait_getter;
    this.parent_store_name = args.parent_store_name;
  }

}
