
import { Dict } from './util';
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
/**
 * An object with string keys and [[NativelyStorable]] values.
 */
interface PlainObject extends Dict<string, NativelyStorable> { } // eslint-disable-line @typescript-eslint/no-empty-interface

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

export type StorableRegistry
  = CodecRegistry<NativelyStorable, Box>
  & {
    isStorable(val: any): val is Encodable;
  };

export function newStorableRegistry(): StorableRegistry {

  const codec_registry = new CodecRegistry<NativelyStorable, Box>({
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

  const result = Object.create(codec_registry);
  result.isStorable = function(val: any): val is Encodable {
    return this.hasCodec(val);
  }
  return result;

}


