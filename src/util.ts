
// see https://fnune.com/typescript/2019/01/30/typescript-series-1-record-is-usually-not-the-best-choice/
export type Dict<K extends keyof any, V> = Partial<Record<K, V>>;

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

export type Codec<Decoded, Encoded> = {
  encode: (decoded: Decoded) => Encoded;
  decode: (encoded: Encoded) => Decoded;
}
