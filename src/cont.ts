
import { Awaitable, Awaitable_map } from './util';

/*-
 * Continuation Monad
 */
export class Cont<T>  {

  /** The wrapped value, expressed as a double-negation under Curry-Howard */
  private readonly nn_val: <R>(callback: (value: T) => R) => R;

  private constructor(
    nn_val: <R>(callback: (value: T) => R) => R,
  ) {
    this.nn_val = nn_val;
  }

  run<R>(f: (value: T) => R): R {
    return this.nn_val(f);
  }

  unsafe_unwrap(): Awaitable<T> {
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
  //   return this.nn_val(x => f(x))
  // but this would fix the value of x, which is not desirable
  bind<S>(f: (value: T) => Cont<S>): Cont<S> {
    return new Cont(k => this.nn_val(x => f(x).nn_val(y => k(y))));
  }

  /** Functor.fmap */
  map<S>(f: (value: T) => S): Cont<S> {
    return new Cont(k => this.nn_val(x => k(f(x))));
  }

}

/*-
 * Similar to Cont<Promise<T>>
 *
 * Pains have been taken to ensure that if you use an AsyncCont with a
 * non-promise value, it will run synchronously.
 */
export class AsyncCont<T> {
  
    private readonly nn_val: <R>(callback: (value: T) => Awaitable<R>) => Awaitable<R>;

    private constructor(
        nn_val: <R>(callback: (value: T) => Awaitable<R>) => Awaitable<R>,
    ) {
      this.nn_val = nn_val;
    }
    
    run<R>(f: (value: T) => Awaitable<R>): Awaitable<R> {
      return this.nn_val(val => Awaitable_map(val, f));
    }

    unsafe_unwrap(): Awaitable<T> {
      return this.run(v => v);
    }

    static fromValue<T>(x: Awaitable<T>): AsyncCont<T> {
      return new AsyncCont(k => Awaitable_map(x, k));
    }

    static fromProducer<T>(prod: () => Awaitable<T>): AsyncCont<T> {
      return new AsyncCont(k => Awaitable_map(prod(), k));
    }

    static fromFunc<T>(func: <R>(callback: (value: T) => Awaitable<R>) => Awaitable<R>): AsyncCont<T> {
      return new AsyncCont(func);
    }

    map<S>(f: (value: T) => Awaitable<S>): AsyncCont<S> {
      return new AsyncCont(k => this.nn_val(x => Awaitable_map(Awaitable_map(x, f), k)));
    }

}

