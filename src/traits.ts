
import { some, Dict, Constructor } from './util';
import { TypeId, hasTypeId, getTypeId } from './type_id';

type NativelyIndexableTrait = IDBValidKey;

type TraitEncoder<T> = (x: T) => NativelyIndexableTrait;
const trait_encoders: Dict<TypeId, TraitEncoder<any>> = {};

export function registerTraitEncoder(constructor: Constructor, encoder: TraitEncoder<any>): void {
  trait_encoders[getTypeId(constructor)] = encoder;
}

type EncodableTrait = { __DONT__: never }

export function traitNeedsEncoding(trait: any): trait is EncodableTrait {
  if (!hasTypeId(trait.constructor)) return false;
  return getTypeId(trait.constructor) in trait_encoders;
}

export type IndexableTrait = NativelyIndexableTrait | EncodableTrait;

export function encodeTrait(trait: IndexableTrait): NativelyIndexableTrait {
  if (traitNeedsEncoding(trait)) {
    const encoder = some(trait_encoders[getTypeId(trait.constructor)]);
    return encoder(trait);
  } else {
    return trait;
  }
}

// No decode function; Jine doesn't require one.

