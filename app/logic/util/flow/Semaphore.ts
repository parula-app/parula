import { arrayRemove } from "../util";

/**
 * Allows a function to ensure that it will never run in parallel
 * more than N times with another instance of the same function.
 * Instead, it will wait until the other instances are finished,
 * so that not mroe than N are running.
 *
 * How to use:
 * 1. Create one instance of this class per function and object that you want to guard.
 * 1.1. If you allow multiple objects of class `A` to run their `A.runner()` independent of each
 *   other, but the same instance of `A` cannot have multiple `A.runner()` running in parallel,
 *   then A class should have an instance of this semaphore as property:
 *   `_runnerMaxParallel = new Semaphore();`.
 * 1.2. If `A.runner()` cannot run in parallel with any other `A.runner()`, even if it's on another object,
 *   then you should make the lock a `static` property on `A`:
 *   `static _runnerMaxParallel = new Semaphore();`
 *
 * 2. In your function, lock and unlock before and after the critical code:
 * ```
 * async runner() {
 *   await someUncriticalCode();
 *   let lock = await this._runnerMaxParallel.lock(); // will wait until the others completed
 *   try {
 *     await criticalCodePath();
 *   } finally {
 *     lock.release();
 *   }
 * }
 * ```
 *
 * 3. Callers of your function can call it in the normal way:
 * `await a.runner();`
 *
 * 4. If your function should not be repeated, you can check whether the lock()
 *   was waiting or not. If it was waiting, you can skip running your function a second time:
 * ```
 * async runner() {
 *   let lock = await this._runnerMaxParallel.lock(); // wait until the others completed
 *   if (lock.wasWaiting) {
 *     lock.release();
 *     return;
 *   }
 *   try {
 *     await someCriticalCodeWhichNeedsToRunOnlyOnce();
 *   } finally {
 *     lock.release();
 *   }
 * ```
 *   However, not that while the previous function started and this function started,
 *   your application state might have changed.
 */
export class Semaphore {
  maxParallel: number;
  /** Tasks currently running.
   * Length should not exceed `maxParallel` (unless the latter changed). */
  protected running: Array<Locked> = [];
  /** Tasks currently not yet running, but waiting for others to finish. */
  protected waiting: Array<Locked> = [];

  constructor(maxParallel: number) {
    this.maxParallel = maxParallel;
  }

  async lock(): Promise<Locked> {
    let locked = new Locked(this);
    locked.wasWaiting = this.needToWait;
    if (locked.wasWaiting) {
      this.waiting.push(locked);
      do {
        if (this.running.length) {
          // Wait for `Locked.release()` of any of the other running tasks
          await Promise.any(this.running.map(locked => locked._promise));
        } else {
          // Nothing is running, so a slot is free, and the first waiting task
          // is about to take it. Let it, then look again.
          // `Promise.any([])` would reject, and we would never run.
          await Promise.resolve();
        }
        // All waiting continue at the same time, but one runs first, and removes itself from waiting,
        // the others also think they are next. Thus, need to check running as well.
      } while (this.waiting[0] != locked || this.running.length >= this.maxParallel)
      this.waiting.shift(); // remove self
      // now, we can run
    }
    this.running.push(locked);
    return locked;
  }

  _unlock(locked: Locked) {
    arrayRemove(this.running, locked);
  }

  get needToWait(): boolean {
    return this.waiting.length > 0 || this.running.length >= this.maxParallel;
  }

  get countRunning(): number {
    return this.running.length;
  }

  get countWaiting(): number {
    return this.waiting.length;
  }
}

export class Locked {
  static _nextID = 1;
  wasWaiting: boolean;
  _promise: Promise<null>;
  _resolve: (value: null) => void;
  _semaphore: Semaphore;
  id: number;

  constructor(semaphore: Semaphore) {
    this.id = Locked._nextID++;
    this._semaphore = semaphore;
    this._promise = new Promise(resolve => {
      this._resolve = resolve;
    });
  }

  release(): void {
    this._semaphore._unlock(this);
    this._resolve(null);
  };
}
