
import { Constructor, Codec } from './util';
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

/**
 * Registry of custom [[Indexable]] types.
 */
export interface IndexableRegistry {

  /**
   * Register a type as [[Indexable]].
   *
   * See {@page Serilization and Custom Types}.
   *
   * @param con The type constructor
   * @param id An arbitrary unique string id
   * @param codec The type encoder and decoder functions
   */
  register<T>(con: Constructor, id: string, codec: Codec<T, Indexable>): void;

  /**
   * Modify a type registration
   *
   * See {@page Serilization and Custom Types}.
   *
   * @param id The id of the type
   * @param updates Type codec modifications
   */
  modify(id: string, updates: Partial<Codec<any, Indexable>>): void;

  /**
   * Modify a type registration, updating existing items in the process.
   *
   * Only use within a database migration.
   *
   * See {@page Serilization and Custom Types}.
   *
   * @param id The id of the type
   * @param args: the new `encode` and `decode` functions, new type constructor (if there is a new one),
   * and function to migrate existing items.
   */
  upgrade(id: string, args: Codec<any, Indexable> & { constructor?: Constructor; migrate: () => Promise<void> }): Promise<void>;

  // --

  /**
   * Check if a constructor is registered as [[Indexable]].
   */
  isRegistered(con: Constructor): boolean;

  /**
   * Check if a value is [[Indexable]].
   */
  isIndexable(val: any): val is Encodable;

  // --

  hasCodec(val: any): val is Encodable;
  encode(val: Indexable, exploding: boolean): NativelyIndexable;
  decode(encoded: NativelyIndexable, exploding: boolean): Indexable;

}
export function newIndexableRegistry(): IndexableRegistry {

  const result = <IndexableRegistry> <any> new CodecRegistry<NativelyIndexable, Box>({
    box_constructor: Array,
    box: (unboxed: NativelyIndexable, metadata: string): Box => {
      return [unboxed, metadata];
    },
    unbox: (boxed: Box): [NativelyIndexable, string] => {
      return boxed;
    },
  });

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
    // See [1]
    const super_encode = CodecRegistry.prototype.encode.bind(this) as any as CodecRegistry<NativelyIndexable, Box>['encode'];
    if (exploding) {
      const array = val as Array<any>;
      return array.map(child => super_encode(child));
    } else {
      return super_encode(val);
    }
  }

  result.decode = function(encoded: NativelyIndexable, exploding: boolean): Indexable {
    // See [1]
    const super_decode = CodecRegistry.prototype.decode.bind(this) as any as CodecRegistry<NativelyIndexable, Box>['decode'];
    if (exploding) {
      const array = encoded as Array<NativelyIndexable>;
      return array.map(child => super_decode(child));
    } else {
      return super_decode(encoded);
    }
  }

  /* [1]

  The `super_` functions MUST go inside of the shadowing function, bound to `this`,
  rather than outside, bound to `result`.

  This is because, elsewhere in the codebase, this registry may be cloned.

  If the `super_` function were bound to `result`, then it would STILL be bound
  to `result` in the cloned object. But we would want it to be bound to the cloned
  version of `result`, not the original version.

  To do so, we need to move the binding to inside the shadowing function.

  This is also discussed in the documentation of true-clone, under 'Gotchas'.

  */

  return result;

}
