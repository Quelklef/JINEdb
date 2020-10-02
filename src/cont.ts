
import { Awaitable, mapAwaitable } from './util';

/*-
 * Continuation Monad
 */
export class Cont<T>  {

  /** The wrapped value, expressed as a double-negation under Curry-Howard */
  private readonly nnVal: <R>(callback: (value: T) => R) => R;

  private constructor(
    nnVal: <R>(callback: (value: T) => R) => R,
  ) {
    this.nnVal = nnVal;
  }

  run<R>(f: (value: T) => R): R {
    return this.nnVal(f);
  }

  unsafeUnwrap(): Awaitable<T> {
    return this.run(v => v);
  }

  /** Monad.return */
  static fromValue<T>(val: T): Cont<T> {
    return new Cont(k => k(val));
  }

  static fromProducer<T>(prod: () => T): Cont<T> {
    return new Cont(k => k(prod()));
  }

  static fromFunc<T>(func: <R>(callback: (value: T) => R) => R): Cont<T> {
    return new Cont(func);
  }

  /** Monad.`>>=` */
  // Implementation could just be
  //   return this.nnVal(x => f(x))
  // but this would fix the value of x, which is not desirable
  bind<S>(f: (value: T) => Cont<S>): Cont<S> {
    return new Cont(k => this.nnVal(x => f(x).nnVal(y => k(y))));
  }

  /** Functor.fmap */
  map<S>(f: (value: T) => S): Cont<S> {
    return new Cont(k => this.nnVal(x => k(f(x))));
  }

}

/*-
 * Similar to Cont<Promise<T>>
 *
 * Pains have been taken to ensure that if you use an AsyncCont with a
 * non-promise value, it will run synchronously.
 */
export class AsyncCont<T> {

    private readonly nnVal: <R>(callback: (value: T) => Awaitable<R>) => Awaitable<R>;

    private constructor(
        nnVal: <R>(callback: (value: T) => Awaitable<R>) => Awaitable<R>,
    ) {
      this.nnVal = nnVal;
    }

    run<R>(f: (value: T) => Awaitable<R>): Awaitable<R> {
      return this.nnVal(val => mapAwaitable(val, f));
    }

    unsafeUnwrap(): Awaitable<T> {
      return this.run(v => v);
    }

    static fromValue<T>(x: Awaitable<T>): AsyncCont<T> {
      return new AsyncCont(k => mapAwaitable(x, k));
    }

    static fromProducer<T>(prod: () => Awaitable<T>): AsyncCont<T> {
      return new AsyncCont(k => mapAwaitable(prod(), k));
    }

    static fromFunc<T>(func: <R>(callback: (value: T) => Awaitable<R>) => Awaitable<R>): AsyncCont<T> {
      return new AsyncCont(func);
    }

    map<S>(f: (value: T) => Awaitable<S>): AsyncCont<S> {
      return new AsyncCont(k => this.nnVal(x => mapAwaitable(mapAwaitable(x, f), k)));
    }

    and<O>(other: AsyncCont<O>): AsyncCont<[T, O]> {
      return new AsyncCont(async k => {
        return await this.run(async x => {
          return await other.run(async y => {
            return await k([x, y]);
          });
        });
      });
    }

}

