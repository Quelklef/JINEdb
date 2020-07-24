
// see https://fnune.com/typescript/2019/01/30/typescript-series-1-record-is-usually-not-the-best-choice/
/**
 *  `Record<string, V>`, but does not assume that a value exists for each key.
 * @typeParam V Type of values
 */
export type Dict<V> = Partial<Record<string, V>>;

/** A value that can be `await`-ed to produce a `T` */
export type Awaitable<T> = T | Promise<T>;

export function Awaitable_map<T, S>(a: Awaitable<T>, f: (v: T) => Awaitable<S>): Awaitable<S> {
  if (a instanceof Promise) return a.then(f);
  return f(a as T);
}

const ctx = this as any;

export const ArrayBufferView_constructors: Array<Constructor> = [];
if (ctx.Int8Array)         ArrayBufferView_constructors.push(ctx.Int8Array);
if (ctx.Uint8Array)        ArrayBufferView_constructors.push(ctx.Uint8Array);
if (ctx.Uint8ClampedArray) ArrayBufferView_constructors.push(ctx.Uint8ClampedArray);
if (ctx.Int16Array)        ArrayBufferView_constructors.push(ctx.Int16Array);
if (ctx.Uint16Array)       ArrayBufferView_constructors.push(ctx.Uint16Array);
if (ctx.Int32Array)        ArrayBufferView_constructors.push(ctx.Int32Array);
if (ctx.Uint32Array)       ArrayBufferView_constructors.push(ctx.Uint32Array);
if (ctx.Float32Array)      ArrayBufferView_constructors.push(ctx.Float32Array);
if (ctx.Float64Array)      ArrayBufferView_constructors.push(ctx.Float64Array);
if (ctx.DataView)          ArrayBufferView_constructors.push(ctx.DataView);

export const ImageBitmap_ImageData_constructors: Array<Constructor> = [];
if (ctx.ImageBitmap) ImageBitmap_ImageData_constructors.push(ctx.ImageBitmap);
if (ctx.ImageData)   ImageBitmap_ImageData_constructors.push(ctx.ImageData);

/**
 * An encoder and decoter for a particular type.
 */
export type Codec<Decoded, Encoded> = {
  encode: (decoded: Decoded) => Encoded;
  decode: (encoded: Encoded) => Decoded;
}

export type Constructor = Function;

export function isPrimitive(x: any): boolean {
  return typeof x !== 'object' || x === null;
}

export function identity<T>(x: T): T {
  return x;
}

export function some<T>(x: T | null | undefined, error_message: string | null): T {
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

/*-
 * For the following use-case:
 *
 * Mapping an error to another error:
 * // throws a DifferentError instance
 * _try(
 *   () => throw Error('err'),
 *   err => err.name === 'err' && throw DifferentError('err'),
 * )
 * // re-throws the original error
 * _try(
 *   () => throw Error('err'),
 *   err => err.name === 'something else' && throw DifferentError('err'),
 * )
 */
export function _try<R>(func: () => R, mapper: (err: Error) => false | Error): R {
  try {
    return func();
  } catch (err) {
    const mapped =  mapper(err);
    throw mapped ? mapped : err;
  }
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
