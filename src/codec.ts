
import { W } from 'wrongish';

import { JineInternalError } from './errors';
import { Constructor, isPrimitive, isInstanceOfStrict } from './util';

/*

List of IndexedDB natively storable types
(According to https://stackoverflow.com/a/22550288/4608364)

null
undefined
boolean
number
BigInt
string
Date
RegExp  (as per the link, note that lastIndex on a RegExp is not preserved)
Blob
File
FileList
ArrayBuffer
ArrayBufferView
ImageBitmap
ImageData
Array
PlainObjectOf
Map
Set


List of IndexedDB natively indexable types
(According to https://w3c.github.io/IndexedDB/)

number  // except for NaN
string
Date  // "except where the [[DateValue]] internal slot is NaN."
ArrayBuffer
ArrayBufferView
Array

*/

function isSome<T>(x: T | null | undefined): x is T {
  return x != null;
}

const idbNonContainerNativelyStorableConstructors: Array<Constructor<unknown>> = ([
  Date,
  RegExp,
  Blob,
  File,
  FileList,
  (document as any)['ArrayBuffer'],
  (document as any)['Int8Array'],
  (document as any)['Uint8Array'],
  (document as any)['Uint8ClampedArray'],
  (document as any)['Int16Array'],
  (document as any)['Uint16Array'],
  (document as any)['Int32Array'],
  (document as any)['Uint32Array'],
  (document as any)['Float32Array'],
  (document as any)['Float64Array'],
  (document as any)['DataView'],
  (document as any)['ImageBitmap'],
  (document as any)['ImageData'],
] as Array<undefined | Constructor<unknown>>)[W.filter2](isSome);

const idbNonContainerNativelyIndexableType: Array<Constructor<unknown>> = ([
  Date,
  (document as any)['ArrayBuffer'],
  (document as any)['Int8Array'],
  (document as any)['Uint8Array'],
  (document as any)['Uint8ClampedArray'],
  (document as any)['Int16Array'],
  (document as any)['Uint16Array'],
  (document as any)['Int32Array'],
  (document as any)['Uint32Array'],
  (document as any)['Float32Array'],
  (document as any)['Float64Array'],
  (document as any)['DataView'],
  (document as any)['ImageBitmap'],
  (document as any)['ImageData'],
] as Array<undefined | Constructor<unknown>>)[W.filter2](isSome);

export type UserCodec = {
  type: Constructor<unknown>;
  id: string;
  encode(it: unknown): unknown;
  decode(it: unknown): unknown;
}

export class Codec {

  private userCodecs: Array<UserCodec>;

  constructor(userCodecs: Array<UserCodec>) {
    const duplicateIds = userCodecs.map(codec => codec.id)[W.duplicates]();
    if (duplicateIds.size > 0)
      throw Error(`[Jine] You have given me multiple codecs with the same id! This is now allowed. Duplicated id(s): ${[...duplicateIds].join(", ")}.`);

    const duplicateTypes = userCodecs.map(codec => codec.type)[W.duplicates]();
    if (duplicateTypes.size > 0)
      throw Error(`[Jine] You have given me multiple codecs for the same type! This is now allowed. Duplicated type(s): ${[...duplicateTypes].join(", ")}.`);

    this.userCodecs = userCodecs;
  }

  encodeItem(item: unknown): unknown {

    if (item === null || 'string number boolean bigint undefined'.includes(typeof item))
      return item as null | string | number | boolean | BigInt | undefined;

    if (isInstanceOfStrict(item, Object)) {
      const asRecord = item as Record<string, unknown>;

      const encoded = {} as Record<string, unknown>;
      for (const key in asRecord)
        encoded[key] = this.encodeItem(asRecord[key]);

      const boxed = { boxedValue: encoded };
      return boxed;
    }

    if (idbNonContainerNativelyStorableConstructors.some(type => isInstanceOfStrict(item, type)))
      return item as unknown;

    if (isInstanceOfStrict(item, Array))
      return item.map(elem => this.encodeItem(elem));

    if (isInstanceOfStrict(item, Map))
      return new Map([...item.entries()].map(([k, v]) => [this.encodeItem(k), this.encodeItem(v)]));

    if (isInstanceOfStrict(item, Set))
      return new Set([...item].map(elem => this.encodeItem(elem)));

    const userCodec = this.userCodecs.find(codec => isInstanceOfStrict(item, codec.type));
    if (userCodec) {
      const encoded = userCodec.encode(item);
      const boxed = { boxedValue: encoded, codecId: userCodec.id };
      return boxed;
    }

    if (typeof item === 'object') {
      const asNonNull = item as object;
      throw Error(`[Jine] I don't know how to store values of type '${asNonNull.constructor.name}'. Did you forget to provide a custom codec?`);
    } else {
      throw Error(`[Jine] I don't know how to store values of type '${typeof item}'.`);
    }

  }

  decodeItem(item: unknown): unknown {

    if (isPrimitive(item))
      return item;

    if (idbNonContainerNativelyStorableConstructors.some(type => isInstanceOfStrict(item, type)))
      return item;

    if (isInstanceOfStrict(item, Array))
      return item.map(elem => this.decodeItem(elem));

    if (isInstanceOfStrict(item, Map))
      return new Map([...item.entries()].map(([k, v]) => [this.decodeItem(k), this.decodeItem(v)]));

    if (isInstanceOfStrict(item, Set))
      return new Set([...item].map(elem => this.decodeItem(elem)))

    if (isInstanceOfStrict(item, Object) && 'boxedValue' in item && !('codecId' in item)) {
      const asBox = item as { boxedValue: Record<string, unknown> };
      const decoded = {} as Record<string, unknown>;
      for (const key in asBox.boxedValue)
        decoded[key] = this.decodeItem(asBox.boxedValue[key]);
      return decoded;
    }

    if (isInstanceOfStrict(item, Object) && 'boxedValue' in item && 'codecId' in item) {
      const asBox = item as { boxedValue: unknown; codecId: string };

      const codec = this.userCodecs.find(codec => codec.id === asBox.codecId);
      if (!codec)
        throw Error(`[Jine] I was unable to find a requested custom codec. It's supposed to have id '${asBox.codecId}'. Did you remove a custom codec recently?`);

      const decoded = codec.decode(asBox.boxedValue);
      return decoded;
    }

    throw new JineInternalError();

  }

  encodeTrait(item: any, indexIsExploding: boolean): unknown {

    if (['number', 'string'].includes(typeof item))
      return item;

    if (idbNonContainerNativelyIndexableType.some(type => isInstanceOfStrict(item, type)))
      return item;

    if (indexIsExploding) {
      if (!(item instanceof Array))
        throw Error(`[Jine] I was asked to encode a trait for an exploding index, but the given trait was not an array!`);

      return item.map(elem => this.encodeTrait(elem, false));
    }

    if (isInstanceOfStrict(item, Array)) {
      const encoded = item.map(elem => this.encodeTrait(elem, false));
      const boxed = ['0', encoded];
      return boxed;
    }

    const codec = this.userCodecs.find(codec => isInstanceOfStrict(item, codec.type));
    if (codec) {
      const encoded = codec.encode(item);
      const boxed = ['1' + codec.id, encoded];
      return boxed;
    }

    if (item === null)
      throw Error(`[Jine] I can't use 'null' to index database items.`);
    else if (typeof item !== 'object')
      throw Error(`[Jine] I can't use use values of type '${typeof item}' to index database items.`);
    else
      throw Error(`[Jine] I don't know how to use values of the type '${item.constructor.name}' to index database items. Did you forget to provide a custom codec?`);

  }

  decodeTrait(item: unknown, indexIsExploding: boolean): unknown {

    if (indexIsExploding) {
      if (!(item instanceof Array))
        throw Error(`[Jine] I was asked to decoded a trait for an exploding index, but the given trait was not an array!`);

      return item.map(elem => this.decodeTrait(elem, false));
    }

    if (['number', 'string'].includes(typeof item))
      return item;

    if (idbNonContainerNativelyIndexableType.some(type => isInstanceOfStrict(item, type)))
      return item;

    if (isInstanceOfStrict(item, Array))
      console.log(item);

    if (isInstanceOfStrict(item, Array) && (item[0] as string) === '0') {
      const unboxed = item[1] as Array<unknown>;
      const decoded = unboxed.map(elem => this.decodeTrait(elem, false));
      return decoded;
    }

    if (isInstanceOfStrict(item, Array) && (item[0] as string).startsWith('1')) {
      const unboxed = item[1] as unknown;

      const codecId = item[0] as string;
      const codec = this.userCodecs.find(codec => codec.id === codecId);
      if (!codec)
        throw Error(`[Jine] I was unable to find a requested custom codec. It's supposed to have id '${codecId}'. Did you remove a custom codec recently?`);

      const decoded = codec.decode(unboxed);
      return decoded;
    }

    throw new JineInternalError();

  }

}
