
import { some, Dict } from './util';
import { Storable, StorableRegistry } from './storable';
import { Indexable, IndexableRegistry } from './indexable';

// Precisely, the schema contains the information that is controlled
// by migrations

export class IndexSchema<Item extends Storable = Storable, Trait extends Indexable = Indexable> {
  name: string;
  unique: boolean;
  explode: boolean;

  // path - string
  // derived - function
  kind: 'path' | 'derived';
  path?: string;
  getter?: (item: Item) => Trait;
  
  storables: StorableRegistry;
  indexables: IndexableRegistry;

  constructor(args: {
    name: string;
    unique: boolean;
    explode: boolean;
    trait_path_or_getter: string | ((item: Item) => Trait);
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this.unique = args.unique;
    this.explode = args.explode;
    this.storables = args.storables;
    this.indexables = args.indexables;

    if (args.trait_path_or_getter instanceof Function) {
      this.kind = 'derived';
      this.getter = args.trait_path_or_getter as (item: Item) => Trait;
    } else {
      this.kind = 'path';
      this.path = args.trait_path_or_getter as string;
    }
  }

  calc_trait(item: Item): Trait {
    if (this.kind === 'path') {
      return (item as any)[some(this.path)];
    } else {
      return some(this.getter)(item);
    }
  }
}

export type StoreSchema<Item extends Storable = Storable> = {
  name: string;
  indexes: Dict<IndexSchema<Item>>;

  storables: StorableRegistry;
  indexables: IndexableRegistry;
};

export type DatabaseSchema = {
  name: string;
  stores: Dict<StoreSchema>;
  
  storables: StorableRegistry;
  indexables: IndexableRegistry;
};
