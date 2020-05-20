
import { Storable, NativelyStorable } from './storable';
import * as storable from './storable';

export interface ItemCodec<Item extends Storable> {
  encode: (item: Item) => Storable;
  decode: (stored: Storable) => Item;
}

export function fullEncode<Item extends Storable>(item: Item, codec: ItemCodec<Item>): NativelyStorable {
  return storable.encode(codec.encode(item));
}

export function fullDecode<Item extends Storable>(stored: NativelyStorable, codec: ItemCodec<Item>): Item {
  return codec.decode(storable.decode(stored));
}
