
// see https://fnune.com/typescript/2019/01/30/typescript-series-1-record-is-usually-not-the-best-choice/
/**
 *  `Record<string, V>`, but does not assume that a value exists for each key.
 * @typeParam V Type of values
 */
export type Dict<V> = Partial<Record<string, V>>;

/**
 * An encoder and decoter for a particular type.
 */
export type Codec<Decoded, Encoded> = {
  encode: (decoded: Decoded) => Encoded;
  decode: (encoded: Encoded) => Decoded;
}

export type Constructor = Function;

export function identity<T>(x: T): T {
  return x;
}

export function some<T>(x: T | null | undefined, error_message?: string): T {
  if (x === undefined || x === null) {
    throw Error(error_message ?? `Called some(${x}).`);
  }
  return x;
}

export function invoke<T>(iife: () => T): T {
  /*

  Used to mark an IIFE (immediately invoked
  function expression).

  */

  return iife();
}

export function DOMStringList_to_Array(dsl: DOMStringList): Array<string> {
  const result = [];
  for (let i = 0; i < dsl.length; i++) {
    result.push('' + dsl.item(i));
  }
  return result;
}
