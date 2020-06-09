
import { Dict } from './util';
import { NativelyStorable } from './storable';
import { NativelyIndexable } from './indexable';

export interface Row {
  id: number;
  payload: NativelyStorable;
  traits: Dict<NativelyIndexable>;
}

