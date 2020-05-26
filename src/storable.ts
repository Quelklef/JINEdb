
import { Dict } from './util';
import { CodecRegistry, Encodable } from './codec-registry';

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
  | RegExp  // as per the link, note that lastIndex on a RegExp is not preserved
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

// --

export type Storable = NativelyStorable | Encodable;

type Box = {
  __JINE_BOX__: NativelyStorable;
  __JINE_META__: string;
};

const registry = new CodecRegistry<NativelyStorable, Box>({
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

export const register = registry.register.bind(registry);
export const encode = registry.encode.bind(registry);
export const decode = registry.decode.bind(registry);

