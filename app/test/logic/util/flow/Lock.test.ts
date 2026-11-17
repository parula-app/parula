import { Lock } from '../../../../logic/util/flow/Lock';
import { sleep } from '../../../../logic/util/util';
import { expect, test } from 'vitest';

class WithLock {
  protected readonly _runnerLock = new Lock();
  ran = 0;
  async run() {
    let lock = await this._runnerLock.lock();
    try {
      this.ran++;
      await sleep(0.1);
    } finally {
      lock.release();
    }
  }
}

class WithoutLock {
  ran = 0;
  async run() {
    this.ran++;
    await sleep(0.1);
  }
}

test("Lock", async () => {
  let a = new WithLock();
  let promise1 = a.run();
  let promise2 = a.run();
  let promise3 = a.run();
  let promise4 = a.run();
  let promise5 = a.run();
  await promise1;
  expect(a.ran).toBe(1);
  await promise2;
  expect(a.ran).toBe(2);
  await promise3;
  expect(a.ran).toBe(3);
  await promise4;
  expect(a.ran).toBe(4);
  await promise5;
  expect(a.ran).toBe(5);
});

test("Lock wasWaiting", async () => {
  let lock = new Lock();
  let first = await lock.lock();
  expect(first.wasWaiting).toBe(false);
  let secondPromise = lock.lock();
  first.release();
  let second = await secondPromise;
  expect(second.wasWaiting).toBe(true);
  second.release();
  // All released, so the next lock() must not report waiting
  let third = await lock.lock();
  expect(third.wasWaiting).toBe(false);
  third.release();
});

test("Lock released twice", async () => {
  let lock = new Lock();
  let hangs = await lock.lock();
  hangs.release(); // e.g. a `Timeout` that broke the lock from outside
  let second = await lock.lock();
  hangs.release(); // the hanging function finally finishes
  let thirdPromise = lock.lock();
  second.release();
  let third = await thirdPromise;
  expect(third.wasWaiting).toBe(true);
  third.release();
  expect(lock.haveWaiting).toBe(false);
});

test("Without Lock", async () => {
  let a = new WithoutLock();
  let promise1 = a.run();
  let promise2 = a.run();
  let promise3 = a.run();
  let promise4 = a.run();
  let promise5 = a.run();
  expect(a.ran).toBe(5);
  await promise1;
  await promise2;
  await promise3;
  await promise4;
  await promise5;
  expect(a.ran).toBe(5);
});
