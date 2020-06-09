
import { Dict } from './util';
import { Storable } from './storable';
import { Indexable } from './indexable';

// TODO: let Dict<T> = Dict<T>
export type IndexStructure<Item extends Storable = Storable, Trait extends Indexable = Indexable> = {
  name: string;
  trait_info: string | ((item: Item) => Trait);
  unique: boolean;
  explode: boolean;
};

export type StoreStructure<Item extends Storable = Storable> = {
  name: string;
  indexes: Dict<IndexStructure<Item>>;
};

export type DatabaseStructure = {
  name: string;
  stores: Dict<StoreStructure>;
};
