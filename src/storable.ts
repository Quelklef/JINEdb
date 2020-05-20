
import { some, Dict, Constructor } from './util';
import { TypeId, getTypeId } from './type_id';

// What types are storable in IndexedDB?
// List is according to https://stackoverflow.com/a/22550288/4608364
export type NativelyStorable
  = null
  | undefined
  | boolean
  | number
  | BigInt
  | string
  | Date
    // as per the link, note that lastIndex on a RegExp is not preserved
  | RegExp  
  | Blob
  | File
  | FileList
  | ArrayBuffer
  | ArrayBufferView
  | ImageBitmap
  | ImageData
  | Array<NativelyStorable>
  | NativelyStorableObject
  | Map<NativelyStorable, NativelyStorable>
  | Set<NativelyStorable>
  ;

// works with "plain" objects. I assume that "plain" means string keys.
// empty interface is a hack to get TS to work
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface NativelyStorableObject extends Dict<string, NativelyStorable> { }

/*

If a user wants Jine to be able to encoder a type beyond the native types,
they may register a codec (encoder + decoder) of their own.

*/

type Encoder<T> = (x: T) => NativelyStorable;
type Decoder<T> = (n: NativelyStorable) => T;

interface Codec<T> {
  encode: Encoder<T>;
  decode: Decoder<T>;
}

const codecs: Dict<TypeId, Codec<any>> = {};

export function register<T>(constructor: Constructor, codec: Codec<T>): void {
  codecs[getTypeId(constructor)] = codec;
}


/*

Define a 'Storable' type to be one that is either natively
storable by IndexedDB or one for which we've defined an encoder.

*/

type Encodable = { __DONT__: never };

export function isEncodable(val: any): val is Encodable {
  return (
    // Must be an object
    val.constructor
    // Cannot be a plain object, since those are natively storable
    && val.constructor !== Object
    // Must be reigstered
    && getTypeId(val.constructor) in codecs);
}

export type Storable = NativelyStorable | Encodable;


/*

Now to encode a Storable item, we do one of three things.

1) If the item is NativelyStorable and is NOT a plain object,
   there's no work to be done. We can just give it to
   indexedDB as-is.

2) If the item is NOT NativelyStorable, then we encode it
   and box it with its type id so that we can decode it
   later. The final product looks like
     { __JINE_TYPE_ID__: id,
       __JINE_ENCODED__: encoded_val }

3) If the item is NativelyStorable but an object, we can't
    give it to IndexedDB as-is. If we did, and somebody
    encoded an item with a __JINE_TYPE_ID__ attribute, then
    decoding would crash and burn.
    So instead we box the item in an object with the shape
      { __JINE_BOX__: item }

This encoding schema requires an overhead for plain objects
as well as custom types. However, it requires no overhead for
non-plain-object natively storable types, which is great!

*/

export function encode(item: Storable): NativelyStorable {
  if (isEncodable(item)) {
    const type_id = getTypeId(item.constructor)
    const encoded = some(codecs[type_id]).encode(item);
    return {
      __JINE_TYPE_ID__: type_id,
      __JINE_ENCODED__: encoded,
    };
  }

  if ((item as Object).constructor === Object) {
    return { __JINE_BOX__: item };
  } else {
    return item as NativelyStorable;
  }
}

export function decode<Item extends Storable>(nat: NativelyStorable): Item {

  if (typeof nat !== 'object')
    return nat as Item;

  if ('__JINE_BOX__' in (nat as object))
    return (nat as any).__JINE_BOX__ as Item;

  const type_id = (nat as any).__JINE_TYPE_ID__ as TypeId;
  const encoded = (nat as any).__JINE_ENCODED__ as NativelyStorable;
  const decoded = some(codecs[type_id]).decode(encoded);
  return decoded;

}
