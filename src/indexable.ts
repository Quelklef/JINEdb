
import { JineError } from './errors';
import { CodecRegistry, Encodable } from './codec-registry';
import { Constructor, Codec, isPrimitive, ArrayBufferView_constructors } from './util';

// What types are indexable in IndexedDB?
// [2020-05-25] List is according to https://w3c.github.io/IndexedDB/
/**
 * Types that Jine is natively able to accept for values of traits.
 */
export type NativelyIndexable
  = number  // except for NaN
  | string
  | Date  // "except where the [[DateValue]] internal slot is NaN."
  | ArrayBuffer
  | ArrayBufferView
  | Array<NativelyIndexable>
  ;

const nativelyIndexableConstructors: Array<Constructor> = [
  Date,
  ArrayBuffer,
  ...ArrayBufferView_constructors,
  Array,
];

/**
 * Values that can be indexed, i.e. used as traits.
 *
 * Jine supports a number of types out-of-the-box (see [[NativelyIndexable]]).
 * To be able to index with a custom type, it must be registered, see [[registerIndexable]].
 */
export type Indexable =
  | NativelyIndexable
  | Encodable
  | Array<Indexable>
  ;

// --

type Box = [NativelyIndexable, string];

/**
 * Registry of custom [[Indexable]] types.
 */
export interface IndexableRegistry {

  /**
   * Register a type as [[Indexable]].
   *
   * See {@page Serialization and Custom Types}.
   *
   * @param con The type constructor
   * @param id An arbitrary unique string id
   * @param codec The type encoder and decoder functions
   */
  register<T>(con: Constructor, id: string, codec: Codec<T, Indexable>): void;

  /**
   * Modify a type registration
   *
   * See {@page Serialization and Custom Types}.
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
   * See {@page Serialization and Custom Types}.
   *
   * @param id The id of the type
   * @param args
   * - `encode: (x: item) => Indexable`: the new encoder function
   * - `decode: (x: encoded) => any`: the new decoder function
   * - `constructor: Function`: (optional) the new type constructor (if there is a new one),
   * - `migrate: () => Promise<void>`: the function to migrate existing items.
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
  indexes. When we store an array, it will be boxed in another array;
  it will be mistaken to pass this to an idb multiEntry index
  since what we want to pass in is an unboxed array of encoded items.
  
  We account for this by adding a boolean 'exploding' argument to
  our encoding and decoding functions. If true, the given array
  will not be boxed, so as to preserve correct exploding behaviour.

  */

  result.encode = function(decoded: Indexable, exploding: boolean): NativelyIndexable {
    
    // vvv See [1]
    const super_encode = CodecRegistry.prototype.encode.bind(this);

    if (isPrimitive(decoded))
      return super_encode(decoded);

    const recognized = decoded?.constructor && (nativelyIndexableConstructors.includes(decoded.constructor) || this.hasCodec(decoded));
    if (!recognized)
      throw new JineError(`Refusing to encode value of unrecognized type '${decoded?.constructor.name}' (did you forget to register it as a custom indexable?).`);

    // vvv Account for exploding/multiEntry indexes
    if (exploding) {
      const array = decoded as Array<Indexable>;
      return array.map(elem => this.encode(elem, false));
    }

    // vvv Recursively encode Array objects in order to allow
    // custom-Indexable types within arrays
    if (decoded instanceof Array) {
      const array = decoded as Array<Indexable>;
      const unboxed = array.map(elem => this.encode(elem, false));
      const boxed = super_encode(unboxed);
      return boxed;
    }

    return super_encode(decoded);
    
  }

  result.decode = function(encoded: NativelyIndexable, exploding: boolean): Indexable {

    // vvv See [1]
    const super_decode = CodecRegistry.prototype.decode.bind(this);

    if (isPrimitive(encoded))
      return super_decode(encoded);

    // vvv Account for exploding/multiEntry indexes
    if (exploding) {
      const array = encoded as Array<NativelyIndexable>;
      return array.map(elem => this.decode(elem, false));
    }

    // vvv Recursively decode Array objects
    // Note that these objects will be boxed
    if (encoded instanceof Array) {
      const boxed = encoded as Box;
      const unboxed: Array<NativelyIndexable> = super_decode(boxed);
      const decoded = unboxed.map(elem => this.decode(elem, false));
      return decoded;
    }
    
    return super_decode(encoded);
    
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
