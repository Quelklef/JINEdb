
import { JineInternalError } from './errors';

// see https://fnune.com/typescript/2019/01/30/typescript-series-1-record-is-usually-not-the-best-choice/
/**
 *  `Record<string, V>`, but does not assume that a value exists for each key.
 * @typeParam V Type of values
 */
export type Dict<V> = Partial<Record<string, V>>;

/** A value that can be `await`-ed to produce a `T` */
export type Awaitable<T> = T | Promise<T>;

export function mapAwaitable<T, S>(a: Awaitable<T>, f: (v: T) => Awaitable<S>): Awaitable<S> {
  return (a instanceof Promise) ? a.then(f) : f(a);
}

export function getPropertyDescriptor(obj: object, prop: number | symbol | string): null | PropertyDescriptor {
  if (!obj) return null;
  return Object.getOwnPropertyDescriptor(obj, prop) || getPropertyDescriptor(Object.getPrototypeOf(obj), prop);
}

// Steps around a TS quirk where Record<string, T> doesn't work in union types
export interface PlainObjectOf<T> extends Record<string, T> { }  // eslint-disable-line @typescript-eslint/no-empty-interface

/**
 * An encoder and decoter for a particular type.
 */
export type Codec<Decoded, Encoded> = {
  encode: (decoded: Decoded) => Encoded;
  decode: (encoded: Encoded) => Decoded;
}

export type Constructor<T> = { new(...args: any[]): T };

export function isPrimitive(x: any): x is (null | undefined | string | number | BigInt | boolean | symbol) {
  return typeof x !== 'object' || x === null;
}

export function identity<T>(x: T): T {
  return x;
}

export function some<T>(x: T | null | undefined, errorMessage: string | null): T {
  if (x === undefined || x === null) {
    throw new JineInternalError(errorMessage ?? `Called some(${x}).`);
  }
  return x;
}

/* instanceof without inheritance */
export function isInstanceOfStrict<T>(val: any, type: Constructor<T>): val is T {
  return val.constructor === type;
}

export function invoke<T>(func: () => T): T {
  // Better syntax for IIFEs than (() => { ... })()
  return func();
}

/*-
 * Oh, boy, am I proud of this function
 *
 * Stack traces are awesome.
 * But sometimes they're not enough.
 * For instance, say an exception is thrown in a queued job. The stack trace
 * tells us what queue the job was in, but it doesn't tell us where the job
 * was defined, which is really what we want to know.
 *
 * This function is our solution.
 * Via abuse of Error objects, it attaches a .__source attribute to the given
 * object, which is a stack trace to when this function was called.
 * If used e.g. in a constructor, this tells us when the object was created.
 *
 * It's reocmmended to use this in a constuctor because it plays nice with v8.
 *
 * Enjoy!
 *
 * @param obj The object to pin down
 * @param attr The attribute to attach the trace to
 */
export function mark(obj: object, attr: string | symbol = '__source'): void {
  const trace = new Error();
  trace.name = 'Trace! :)  ';
  (obj as any)[attr] = trace;

  if (trace.stack) {
    // remove top line, which is invokation of this function
    const lines = trace.stack.split('\n');
    trace.stack = [lines[0], ...lines.slice(2)].join('\n');
  }
}
