
import { CodecRegistry, Encodable } from './codec-registry';

// What types are indexable in IndexedDB?
// [2020-05-25] List is according to https://w3c.github.io/IndexedDB/
export type NativelyIndexable
  = number  // except for NaN
  | Date  // "except where the [[DateValue]] internal slot is NaN."
  | String
  | ArrayBuffer
  | ArrayBufferView
  | Array<NativelyIndexable>
  ;

export type Indexable = NativelyIndexable | Encodable;

// --

type Box = [NativelyIndexable, string];

const registry = new CodecRegistry<NativelyIndexable, Box>({
  box_constructor: Array,
  box: (unboxed: NativelyIndexable, metadata: string): Box => {
    return [unboxed, metadata];
  },
  unbox: (boxed: Box): [NativelyIndexable, string] => {
    return boxed;
  },
});

export const register = registry.register.bind(registry);

/*

An unforunate situation has arisen.

Because arrays are the only natively indexable container type,
we MUST use them in order to do boxing and unboxing with
the registry.

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

export function encode(val: any, exploding: boolean): NativelyIndexable {
  if (exploding) {
    const array = val as Array<any>;
    return array.map(child => registry.encode(child));
  } else {
    return registry.encode(val);
  }
}

export function decode(encoded: NativelyIndexable, exploding: boolean): any {
  if (exploding) {
    const array = encoded as Array<NativelyIndexable>;
    return array.map(child => registry.decode(child));
  } else {
    return registry.decode(encoded);
  }
}

