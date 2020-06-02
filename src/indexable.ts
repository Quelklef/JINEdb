
import { CodecRegistry, Encodable } from './codec-registry';

// What types are indexable in IndexedDB?
// [2020-05-25] List is according to https://w3c.github.io/IndexedDB/
/**
 * Types that Jine is natively able to accept for values of traits.
 */
export type NativelyIndexable
  = number  // except for NaN
  | Date  // "except where the [[DateValue]] internal slot is NaN."
  | String
  | ArrayBuffer
  | ArrayBufferView
  | Array<NativelyIndexable>
  ;

/**
 * Values that can be indexed, i.e. used as traits.
 *
 * Jine supports a number of types out-of-the-box (see [[NativelyIndexable]]).
 * To be able to index with a custom type, it must be registered, see [[registerIndexable]].
 */
export type Indexable = NativelyIndexable | Encodable;

// --

type Box = [NativelyIndexable, string];

export type IndexableRegistry
  = CodecRegistry<NativelyIndexable, Box>
  & {
    isIndexable(val: any): val is Encodable;
    encode(val: Indexable, exploding: boolean): NativelyIndexable;
    decode(encoded: NativelyIndexable, exploding: boolean): Indexable;
  };

export function newIndexableRegistry(): IndexableRegistry {

  const codec_registry = new CodecRegistry<NativelyIndexable, Box>({
    box_constructor: Array,
    box: (unboxed: NativelyIndexable, metadata: string): Box => {
      return [unboxed, metadata];
    },
    unbox: (boxed: Box): [NativelyIndexable, string] => {
      return boxed;
    },
  });

  const result = Object.create(codec_registry);

  result.isIndexable = function(val: any): val is Encodable {
    return this.hasCodec(val);
  }

  /*

  An unforunate situation has arisen.

  Because arrays are the only natively indexable container type,
  we MUST use them in order to do boxing and unboxing with
  the codec registry.

  This is an issue when it comes to exploding (i.e. multiEntry)
  indexes. If an exploding index is supplied an array, it will
  index each item in the array rather than the array as a whole.

  However, since we use arrays as boxes, that means that the
  exploding index values will be boxed within an array and won't
  properly explode.

  We account for this by adding a boolean 'exploding' argument to
  our encoding and decoding functions. If true, the given array
  will not be boxed, so as to preserve correct exploding behaviour.

  */

  result.encode = function(val: Indexable, exploding: boolean): NativelyIndexable {
    if (exploding) {
      const array = val as Array<any>;
      return array.map(child => codec_registry.encode(child));
    } else {
      return codec_registry.encode(val);
    }
  }

  result.decode = function(encoded: NativelyIndexable, exploding: boolean): Indexable {
    if (exploding) {
      const array = encoded as Array<NativelyIndexable>;
      return array.map(child => codec_registry.decode(child));
    } else {
      return codec_registry.decode(encoded);
    }
  }

  return result;

}
