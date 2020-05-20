
import { NativelyStorable } from './storable';
import { IndexableTrait } from './traits';
import { Dict } from './util';

export interface Row {
  id: number;
  payload: NativelyStorable;
  traits: Dict<string, IndexableTrait>;
}
