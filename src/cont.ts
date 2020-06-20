
import { Awaitable } from './util';

/*-
 * Continuation Monad
 */
export class Cont<T>  {

  /** The wrapped value, expressed as a double-negation under Curry-Howard */
  private readonly nn_val: <R>(callback: (value: T) => R) => R;

  /**
   * True iff this was made via [[Cont.fromValue]] and then possibly mapped
   * over, etc.
   *
   * If a continuation is trivial, we know that (1) its value will not change
   * between calls to [[Cont.run]] and (2) the continuation has no "before"
   * or "after" operations. Thus, the continuation may be treated as the value
   * it wraps.
   *
   * Note that a continuation may satisfy both of these but be made with something
   * other than [[Cont.fromValue]] and thus will not register as trivial.
   */
  public readonly trivial: boolean

  private constructor(
    nn_val: <R>(callback: (value: T) => R) => R,
    trivial: boolean,
  ) {
    this.nn_val = nn_val;
    this.trivial = trivial;
  }

  run<R>(f: (value: T) => R): R {
    return this.nn_val(f);
  }

  /**
   * Unwrap the value from the continuation.
   * Generally, avoid this on nontrivial continuations.
   */
  unwrap(): T {
    let value!: T;
    this.run(v => value = v);
    return value;
  }

  /** Monad.return */
  static fromValue<T>(val: T): Cont<T> {
    return new Cont(k => k(val), true);
  }

  static fromProducer<T>(prod: () => T): Cont<T> {
    return new Cont(k => k(prod()), false);
  }

  static fromFunc<T>(func: <R>(callback: (value: T) => R) => R): Cont<T> {
    return new Cont(func, false);
  }

  /** Monad.`>>=` */
  // Implementation could just be
  //   return this.nn_val(x => f(x))
  // but this would fix the value of x, which is not desirable
  bind<S>(f: (value: T) => Cont<S>): Cont<S> {
    if (this.trivial) {
      return f(this.unwrap());
    } else {
      return new Cont(k => this.nn_val(x => f(x).nn_val(y => k(y))), false);
    }
  }

  /** Functor.fmap */
  map<S>(f: (value: T) => S): Cont<S> {
    return new Cont(k => this.nn_val(x => k(f(x))), this.trivial);
  }

}

/*-
 * Similar to Cont<Promise<T>>
 *
 * Pains have been taken to ensure that if you use an AsyncCont with a
 * non-promise value, it will run synchronously.
 */
export class AsyncCont<T> {
  
    private readonly nn_val: <R>(callback: (value: Awaitable<T>) => R) => R;
    public readonly trivial: boolean;

    private constructor(
        nn_val: <R>(callback: (value: Awaitable<T>) => R) => R,
        trivial: boolean,
    ) {
      this.nn_val = nn_val;
      this.trivial = trivial;
    }
    
    run<R>(f: (value: T) => Awaitable<R>): Awaitable<R> {
        return this.nn_val(val => val instanceof Promise ? val.then(f) : f(val));
    }

    unwrap(): T | Promise<T> {
      let value!: T | Promise<T>;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.nn_val(v => value = v);
      return value;
    }

    static fromValue<T>(x: Awaitable<T>): AsyncCont<T> {
      return new AsyncCont(k => k(x), true);
    }

    static fromProducer<T>(prod: () => Awaitable<T>): AsyncCont<T> {
      return new AsyncCont(k => k(prod()), false);
    }

    static fromFunc<T>(func: <R>(callback: (value: Promise<T>) => R) => R): AsyncCont<T> {
      return new AsyncCont(func, false);
    }

    map<S>(f: (value: T) => Awaitable<S>): AsyncCont<S> {
      return new AsyncCont(k => this.nn_val(x => x instanceof Promise ? k(x.then(f)) : k(f(x))), this.trivial);
    }

}

