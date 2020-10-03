
import { Awaitable, mapAwaitable } from './util';

/*-
 * A PACont is a parameterized async continuation.
 *
 * A continuation of type T is a value of type <R>(callback: (val: T) => R) => R. This represents
 * a computation guarding a value of type T. To use the value, you pass in a callback; the continuation
 * then performs a computating, calling your callback in the meantime, and then returns whatever your
 * callback returned.
 *
 * For instance, perhaps you have a config file which stores simple string key/value pairs. And say you
 * want to be able to read *and update* the config at certain points during the program, but you don't
 * want to keep the file open during the entire program. You may write a function like this:
 *   function doSomethingWithConfig<Result>(callback: (config: [string, string][]) => Result): Result {
 *     // the 'before' code
 *     const file = openFile('myFancyConfigFile');
 *     const pairs = parseConfig(file.readAll());
 *     // the 'main' code
 *     const result = callback(config);
 *     // the 'after' code
 *     file.write(printConfig(pairs)); // The pair array may have been mutated; update the file
 *     file.close();
 *     return result;
 *   }
 * This is an example of a continuation. The value `pairs` is being guaded by the computation of opening
 * the file and parsing it, and then writing to the file and closing it.
 * Mind you, in this case, it would probably make sense to simply parse the config at the very beginning of
 * the program and then only deal with the `Config` option henceforth.
 *
 * A parameterized continuation is a continuation that can take another argument.
 *
 * So, for instance, perhaps we have multiple configuration files, so we want to take the file name as an
 * argument. Then we'd write something like
 *   function doSomethingWithConfig<Result>(filename: string, callback: (config: [string, string][]) => Result): Result {
 *     const file = openFile(filename);
 *     // ... rest of the function the same
 *   }
 *
 * An async continuation of type T is like a continuation of type T, but instead of being
 *   <R>(k: (x: T) => R) => R
 * it's
 *   <R>(k: (x: T) => Promise<R>) => Promise<R>
 *
 * We will be using parameterized async continuations :)
 *
 * Pains have been taken to ensure that if you use an PACont with a
 * non-promise value, it will run synchronously.
 */

// Parameterized async continuations
export class PACont<Val, Param = undefined> {

    private readonly func: <R>(callback: (val: Val) => Awaitable<R>, param: Param) => Awaitable<R>;

    private constructor(
        func: <R>(callback: (val: Val) => Awaitable<R>, param: Param) => Awaitable<R>
    ) {
      this.func = func;
    }

    run<R>(callback: (value: Val) => Awaitable<R>): undefined extends Param ? Awaitable<R> : never;
    run<R>(param: Param, callback: (value: Val) => Awaitable<R>): Awaitable<R>;
    run<R>(...args: unknown[]): unknown {
      if (args.length === 2) {
        const [param, callback] = args;
        return (this.func as any)(callback, param)
      } else {
        const [callback] = args;
        return (this.func as any)(callback, undefined);
      }
    }

    // Unsafe because it allows using the guarded value after the 'after' code as been run
    unsafeUnwrap(): undefined extends Param ? Awaitable<Val> : never;
    unsafeUnwrap(param: Param): Awaitable<Val>;
    unsafeUnwrap(param?: unknown): Awaitable<Val> {
      return this.run(param as Param, val => val);
    }

    static fromValue<Val>(val: Awaitable<Val>): PACont<Val> {
      return new PACont(callback => mapAwaitable(val, callback));
    }

    // When there is no 'after' code
    static fromProducer<Val>(prod: () => Awaitable<Val>): PACont<Val>
    static fromProducer<Val, Param = undefined>(prod: (param: Param) => Awaitable<Val>): PACont<Val, Param> {
      return new PACont((callback, param) => mapAwaitable(prod(param), callback));
    }

    static fromFunc<Val, Param = undefined>(func: <R>(callback: (val: Val) => Awaitable<R>, param: Param) => Awaitable<R>): PACont<Val, Param> {
      return new PACont(func);
    }

    map<NewVal>(mapper: (value: Val) => Awaitable<NewVal>): PACont<NewVal, Param> {
      return new PACont((callback, param) => this.func(val => mapAwaitable(mapper(val), callback), param));
    }

    /*-
     * Combine a parameterized continuation with an unparameterized continuation
     *
     * The code
     *   PACont.pair(cont1, cont2).run(param, (val1, val2) => { ... })
     * is equivalent to
     *   cont1.run(param, val1 => cont2.run(undefined, val2 => { ... }))
     */
    static pair<Val1, Val2, Param = undefined>(
      cont1: PACont<Val1, Param>,
      cont2: PACont<Val2, undefined>
    ): PACont<[Val1, Val2], Param> {
      return new PACont((callback, param) => cont1.run(param, val1 => cont2.run(undefined, val2 => callback([val1, val2]))));
    }

}

