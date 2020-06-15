
import { Dict, Constructor, Codec } from './util';
import { CodecRegistry, Encodable } from './codec-registry';

// List is according to https://stackoverflow.com/a/22550288/4608364
/**
 * Types that Jine is able to store out-of-the-box.
 */
export type NativelyStorable
  = null
  | undefined
  | boolean
  | number
  | BigInt
  | string
  | Date
  | RegExp  // as per the link, note that lastIndex on a RegExp is not preserved
  | Blob
  | File
  | FileList
  | ArrayBuffer
  | ArrayBufferView
  | ImageBitmap
  | ImageData
  | Array<NativelyStorable>
  | PlainObject
  | Map<NativelyStorable, NativelyStorable>
  | Set<NativelyStorable>
  ;

// works with "plain" objects. I assume that "plain" means string keys.
// (empty interface is a hack to get TS to work)
interface PlainObject extends Dict<NativelyStorable> { } // eslint-disable-line @typescript-eslint/no-empty-interface

// --

/**
 * Types that Jine is able to store.
 *
 * Jine supports a number of types out-of-the-box (see [[NativelyStorable]]).
 * To be able to store a custom type, it must be registered, see [[registerStorable]].
 */
export type Storable = NativelyStorable | Encodable;

type Box = {
  __JINE_BOX__: NativelyStorable;
  __JINE_META__: string;
};

/**
 * Registry of custom [[Storable]] types.
 */
export interface StorableRegistry {

  /**
   * Register a type as [[Storable]].
   *
   * See {@page Serialization and Custom Types}.
   *
   * @param con The type constructor
   * @param id An arbitrary unique string id
   * @param codec The type encoder and decoder functions
   */
  register<T>(con: Constructor, id: string, codec: Codec<T, Storable>): void;

  /**
   * Modify a type registration
   *
   * See {@page Serialization and Custom Types}.
   *
   * @param id The id of the type
   * @param updates Type codec modifications
   */
  modify(id: string, updates: Partial<Codec<any, Storable>>): void;

  /**
   * Modify a type registration, updating existing items in the process.
   *
   * Only use within a database migration.
   *
   * See {@page Serialization and Custom Types}.
   *
   * @param id The id of the type
   * @param args
   * - `encode: (x: item) => Storable`: the new encoder function
   * - `decode: (x: encoded) => any`: the new decoder function
   * - `constructor: Function`: (optional) the new type constructor (if there is a new one),
   * - `migrate: () => Promise<void>`: the function to migrate existing items.
   */
  upgrade(id: string, args: Codec<any, Storable> & { constructor?: Constructor; migrate: () => Promise<void> }): Promise<void>;

  // --

  /**
   * Check if a constructor is registered as [[Storable]].
   */
  isRegistered(con: Constructor): boolean;

  /**
   * Check if a value is [[Storable]].
   */
  isStorable(val: any): val is Encodable;

  // --

  hasCodec(val: any): val is Encodable;
  encode(val: Storable): NativelyStorable;
  decode(val: NativelyStorable): Storable;

}

export function newStorableRegistry(): StorableRegistry {

  const result = <StorableRegistry> <any> new CodecRegistry<NativelyStorable, Box>({
    box_constructor: Object,
    box: (unboxed: NativelyStorable, metadata: string): Box => {
      return {
        __JINE_BOX__: unboxed,
        __JINE_META__: metadata,
      };
    },
    unbox: (boxed: Box): [NativelyStorable, string] => {
      return [boxed.__JINE_BOX__, boxed.__JINE_META__];
    },
  });

  result.isStorable = function(val: any): val is Encodable {
    return this.hasCodec(val);
  }
  return result;

}

