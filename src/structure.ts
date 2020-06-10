
import { Storable } from './storable';
import { Indexable } from './indexable';
import { some, Dict } from './util';

export class IndexStructure<Item extends Storable = Storable, Trait extends Indexable = Indexable> {
  name: string;
  unique: boolean;
  explode: boolean;

  // path - string
  // derived - function
  kind: 'path' | 'derived';
  path?: string;
  getter?: (item: Item) => Trait;

  constructor(args: {
    name: string;
    unique: boolean;
    explode: boolean;
    trait_path_or_getter: string | ((item: Item) => Trait);
  }) {
    this.name = args.name;
    this.unique = args.unique;
    this.explode = args.explode;

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

export type StoreStructure<Item extends Storable = Storable> = {
  name: string;
  indexes: Dict<IndexStructure<Item>>;
};

export type DatabaseStructure = {
  name: string;
  stores: Dict<StoreStructure>;
};
