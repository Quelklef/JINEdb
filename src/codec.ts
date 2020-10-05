
import { W } from 'wrongish';

import { Constructor, PlainObjectOf, isInstanceOfStrict } from './util';
import { JineError, JineEncodingError, JineDecodingError, JineInternalError } from './errors';

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

function resolve(names: string): Array<string | Constructor<unknown>> {
  return names
    .split(/\W/)
    .filter(name => name !== '')
    .map(name =>
      name[0].toLowerCase() === name[0] ? name  // primitive type
      : (window as any)[name] as Constructor<unknown> | undefined  // constructor
    )
    [W.filter2](<T>(type: undefined | T): type is T => type !== undefined)
}

const idbNativelyStorableTypes = resolve(`
  undefined null string number boolean bigint
  Date RegExp Blob
  File FileList ArrayBuffer
  Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array DataView
  ImageBitmap ImageData
  Array Object Map Set
`);

type IdbNativelyStorable =
  undefined | null | string | number | boolean | BigInt
  | Date | RegExp | Blob
  | File | FileList | ArrayBuffer
  | ArrayBufferView
  | ImageBitmap | ImageData
  | Array<NativelyStorable> | PlainObjectOf<NativelyStorable> | Map<NativelyStorable, NativelyStorable> | Set<NativelyStorable>
  ;

const idbNativelyIndexableTypes = resolve(`
  string number
  Date
  ArrayBuffer
  Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array DataView
  ImageBitmap ImageData
  Array
`);

type IdbNativelyIndexable =
  string | number
  | Date
  | ArrayBuffer
  | ArrayBufferView
  | ImageBitmap | ImageData
  | Array<NativelyIndexable>
  ;

export type NativelyStorable = IdbNativelyStorable
export type NativelyIndexable = IdbNativelyIndexable;

// Typescript users should tag their custom types with what they encode to
export declare const encodesTo: unique symbol;

export type Storable = NativelyStorable | { [encodesTo]: NativelyStorable };
export type Indexable = NativelyIndexable | { [encodesTo]: NativelyIndexable };

function isOfAny(value: any, types: Array<string | Constructor<unknown>>): boolean {
  return types.some(type =>
    value === null && type === 'null'
    || typeof value === type
    || isInstanceOfStrict(value, type as Constructor<unknown>)
  );
}

function isOfNativelyStorableType(value: any, opts?: { except: Array<string | Constructor<unknown>> }): boolean {
  return isOfAny(value, idbNativelyStorableTypes) && !isOfAny(value, opts?.except ?? []);
}

function isOfNativelyIndexableType(value: any, opts?: { except: Array<string | Constructor<unknown>> }): boolean {
  return isOfAny(value, idbNativelyIndexableTypes) && !isOfAny(value, opts?.except ?? []);
}

function typeNamePretty(value: any): string {
  return value === null ? 'null'
    : typeof value === 'object' ? value.constructor.name
    : typeof value;
}

// --

export interface UserCodec<Decoded = any, Encoded extends NativelyStorable | NativelyIndexable = any> {
  type: Constructor<unknown>;
  id: string;
  encode(it: Decoded): Encoded;
  decode(it: Encoded): Decoded;
}

// Because the Database constructor asks for an Array<UserCodec>, and typescript doesn't have
// existential types, then those codecs won't necessarily be type-safe.
// To make them more safe, create them with this function.
export function codec<Decoded, Encoded extends NativelyStorable | NativelyIndexable>(
  type: Constructor<unknown>,
  id: string,
  code: {
    encode(it: Decoded): Encoded;
    decode(it: Encoded): Decoded;
  },
): UserCodec<Decoded, Encoded> {
  return { type, id, encode: code.encode, decode: code.decode };
}

function getUserCodecById(userCodecs: Array<UserCodec>, id: string): UserCodec {
  const codec = userCodecs.find(codec => codec.id === id);
  if (!codec)
    throw new JineDecodingError(`I was unable to find a requested custom codec. It's supposed to have id '${id}'. Did you remove a custom codec recently?`);
  return codec;
}

// exported for tests
export const codecIdMark: unique symbol = Symbol('JINEdb codec id');

function validateUserCodecs(userCodecs: Array<UserCodec>): void {
  const duplicateIds = userCodecs.map(codec => codec.id)[W.duplicates]();
  if (duplicateIds.size > 0)
    throw new JineError(`You have given me multiple codecs with the same id! This is now allowed. Duplicated id(s): ${[...duplicateIds].join(", ")}.`);

  const duplicateTypes = userCodecs.map(codec => codec.type)[W.duplicates]();
  if (duplicateTypes.size > 0)
    throw new JineError(`You have given me multiple codecs for the same type! This is now allowed. Duplicated type(s): ${[...duplicateTypes].join(", ")}.`);
}

export class Codec {

  // vv Could be typed better, but no point
  constructor(
    public encodeItem: (it: any) => unknown,
    public decodeItem: (it: any) => unknown,
    public encodeTrait: (it: any, indexIsExploding: boolean) => unknown,
    public decodeTrait: (it: any, indexIsExploding: boolean) => unknown,
  ) { }

  static usualCodec(userCodecs: Array<UserCodec>): Codec {
    validateUserCodecs(userCodecs);

    function encodeItem(decoded: any): unknown {
      if (isOfNativelyStorableType(decoded, { except: [Object, Array, Map, Set] }))
        return decoded;

      if (isInstanceOfStrict(decoded, Array))
        return decoded.map(elem => encodeItem(elem));

      if (isInstanceOfStrict(decoded, Map))
        return new Map([...decoded.entries()].map(([k, v]) => [encodeItem(k), encodeItem(v)]));

      if (isInstanceOfStrict(decoded, Set))
        return new Set([...decoded].map(elem => encodeItem(elem)));

      if (isInstanceOfStrict(decoded, Object)) {
        const encoded = {} as any;
        for (const key in decoded)
          encoded[key] = encodeItem(decoded[key]);
        const boxed = { boxedValue: encoded, codecId: null }
        return boxed;
      }

      const userCodec = userCodecs.find(codec => isInstanceOfStrict(decoded, codec.type));
      if (userCodec) {
        let shallowlyEncoded = userCodec.encode(decoded);
        // vv If encoded to another custom type, expand
        if (!isOfNativelyStorableType(shallowlyEncoded))
          shallowlyEncoded = encodeItem(shallowlyEncoded);
        // vv Ensure it resolved to a plain object. This is so that we can mark it in the migration codec.
        if (!isInstanceOfStrict(shallowlyEncoded, Object))
          throw new JineEncodingError(`An item of custom type '${userCodec.id}' encoded to something other than a plain object. This is not allowed!`);

        const deeplyEncoded = {} as any;
        for (const key in shallowlyEncoded)
          deeplyEncoded[key] = encodeItem(shallowlyEncoded[key]);

        const boxed = { boxedValue: deeplyEncoded, codecId: userCodec.id };
        return boxed;
      }

      throw new JineEncodingError(`I don't know how to store values of type '${typeNamePretty(decoded)}'. (If this is an Object type, did you forget to provide a custom codec?)`);
    }

    function decodeItem(encoded: any): unknown {
      if (isOfNativelyStorableType(encoded, { except: [Array, Map, Set, Object] }))
        return encoded;

      if (isInstanceOfStrict(encoded, Array))
        return encoded.map(elem => decodeItem(elem));

      if (isInstanceOfStrict(encoded, Map))
        return new Map([...encoded.entries()].map(([k, v]) => [decodeItem(k), decodeItem(v)]));

      if (isInstanceOfStrict(encoded, Set))
        return new Set([...encoded].map(elem => decodeItem(elem)))

      if (isInstanceOfStrict(encoded, Object)) {
        if (!('codecId' in encoded)) throw new JineInternalError();
        const { boxedValue, codecId } = encoded as { boxedValue: any; codecId: string | null };
        if (codecId === null) {
          const decoded = {} as any;
          for (const key in boxedValue)
            decoded[key] = decodeItem(boxedValue[key]);
          return decoded;
        } else {
          let innerDecoded: any;
          if (isInstanceOfStrict(boxedValue, Object)) {
            innerDecoded = {};
            for (const key in boxedValue)
              innerDecoded[key] = decodeItem(boxedValue[key]);
          } else {
            innerDecoded = decodeItem(boxedValue);
          }
          const userCodec = getUserCodecById(userCodecs, codecId);
          const decoded = userCodec.decode(innerDecoded);
          return decoded;
        }
      }

      throw new JineInternalError();
    }

    function encodeTrait(item: any, indexIsExploding: boolean): unknown {
      if (isOfNativelyIndexableType(item, { except: [Array] }))
        return item;

      if (indexIsExploding) {
        if (!(item instanceof Array))
          throw new JineEncodingError(`I was asked to encode a trait for an exploding index, but the given trait was not an array!`);
        return item.map(elem => encodeTrait(elem, false));
      }

      if (isInstanceOfStrict(item, Array)) {
        const encoded = item.map(elem => encodeTrait(elem, false));
        const boxed = [0, encoded];
        return boxed;
      }

      const codec = userCodecs.find(codec => isInstanceOfStrict(item, codec.type));
      if (codec) {
        const encoded = codec.encode(item);
        const boxed = [1, codec.id, encoded];
        return boxed;
      }

      throw new JineEncodingError(`I can't use use values of type '${typeNamePretty(item)}' to index database items. (If this is an Object type, did you forget to provide a custom codec?)`);
    }

    function decodeTrait(item: any, indexIsExploding: boolean): unknown {
      if (indexIsExploding) {
        if (!(item instanceof Array))
          throw new JineDecodingError(`I was asked to decoded a trait for an exploding index, but the given trait was not an array!`);
        return item.map(elem => decodeTrait(elem, false));
      }

      if (isOfNativelyIndexableType(item, { except: [Array] }))
        return item;

      if (isInstanceOfStrict(item, Array) && (item[0] as 0 | 1) === 0) {
        const [_, unboxed] = item as [0, Array<unknown>];
        const decoded = unboxed.map(elem => decodeTrait(elem, false));
        return decoded;
      }

      if (isInstanceOfStrict(item, Array) && (item[0] as 0 | 1) === 1) {
        const [_, codecId, unboxed] = item as [1, string, unknown];
        const codec = getUserCodecById(userCodecs, codecId);
        const decoded = codec.decode(unboxed);
        return decoded;
      }

      throw new JineInternalError();
    }

    return new Codec(encodeItem, decodeItem, encodeTrait, decodeTrait);
  }

  static migrationCodec(): Codec {
    function decodeItem(encoded: any): unknown {
      if (isOfNativelyStorableType(encoded, { except: [Array, Map, Set, Object] }))
        return encoded;

      if (isInstanceOfStrict(encoded, Array))
        return encoded.map(elem => decodeItem(elem));

      if (isInstanceOfStrict(encoded, Map))
        return new Map([...encoded.entries()].map(([k, v]) => [decodeItem(k), decodeItem(v)]));

      if (isInstanceOfStrict(encoded, Set))
        return new Set([...encoded].map(elem => decodeItem(elem)))

      if (isInstanceOfStrict(encoded, Object)) {
        if (!('codecId' in encoded)) throw new JineInternalError();
        const { boxedValue, codecId } = encoded as { boxedValue: any; codecId: null | string };
        const decoded = {} as any;
        for (const key in boxedValue)
          decoded[key] = decodeItem(boxedValue[key]);
        const marked = Object.assign(decoded, { [codecIdMark]: codecId });
        return marked;
      }

      throw new JineInternalError();
    }

    function encodeItem(marked: any): unknown {
      if (isOfNativelyStorableType(marked, { except: [Object, Array, Map, Set] }))
        return marked;

      if (isInstanceOfStrict(marked, Array))
        return marked.map(elem => encodeItem(elem));

      if (isInstanceOfStrict(marked, Map))
        return new Map([...marked.entries()].map(([k, v]) => [encodeItem(k), encodeItem(v)]));

      if (isInstanceOfStrict(marked, Set))
        return new Set([...marked].map(elem => encodeItem(elem)));

      if (isInstanceOfStrict(marked, Object)) {
        if (!(codecIdMark in marked)) throw new JineEncodingError(`I was trying to encode a value of type '${typeNamePretty(marked)}', but could not find some information that I needed. Are you doing tricky data manipulations during a migration?`);
        const codecId = marked[codecIdMark] as null | string;
        const encoded = {} as any;
        for (const key in marked)
          encoded[key] = encodeItem(marked[key]);
        const boxed = { boxedValue: encoded, codecId: codecId };
        return boxed;
      }

      throw new JineInternalError();
    }

    function decodeTrait(..._args: Array<unknown>): unknown {
      throw new JineInternalError('Traits are not accessible during migrations');
    }

    function encodeTrait(..._args: Array<unknown>): unknown {
      throw new JineInternalError('Traits are not accessible during migrations');
    }

    return new Codec(encodeItem, decodeItem, encodeTrait, decodeTrait);
  }

}
