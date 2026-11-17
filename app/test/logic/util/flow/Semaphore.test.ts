import { Semaphore } from '../../../../logic/util/flow/Semaphore';
import { sleep } from '../../../../logic/util/util';
import { expect, test } from 'vitest';

class WithSemaphore {
  sema = new Semaphore(3);
  ran = 0;
  async run() {
    let lock = await this.sema.lock();
    try {
      await sleep(0.1);
      this.ran++;
    } finally {
      lock.release();
    }
  }
}

test("Semaphore", async () => {
  let a = new WithSemaphore();
  a.sema.maxParallel = 3;
  let promise1 = a.run();
  let promise2 = a.run();
  let promise3 = a.run();
  let promise4 = a.run();
  let promise5 = a.run();
  let promise6 = a.run();
  let promise7 = a.run();
  let promise8 = a.run();
  let promise9 = a.run();

  await promise1;
  expect(a.ran).toBeLessThanOrEqual(a.sema.maxParallel);
  expect(a.sema.countRunning).toBeLessThanOrEqual(a.sema.maxParallel);
  await promise2;
  expect(a.ran).toBeLessThanOrEqual(a.sema.maxParallel);
  expect(a.sema.countRunning).toBeLessThanOrEqual(a.sema.maxParallel);
  await promise3;
  expect(a.ran).toBeLessThanOrEqual(a.sema.maxParallel);
  expect(a.sema.countRunning).toBeLessThanOrEqual(a.sema.maxParallel);
  await promise4;
  expect(a.ran).toBeLessThanOrEqual(a.sema.maxParallel * 2);
  expect(a.sema.countRunning).toBeLessThanOrEqual(a.sema.maxParallel);
  await promise5;
  expect(a.ran).toBeLessThanOrEqual(a.sema.maxParallel * 2);
  expect(a.sema.countRunning).toBeLessThanOrEqual(a.sema.maxParallel);
  await promise6;
  expect(a.ran).toBeLessThanOrEqual(a.sema.maxParallel * 2);
  expect(a.sema.countRunning).toBeLessThanOrEqual(a.sema.maxParallel);
  await promise7;
  expect(a.ran).toBeLessThanOrEqual(a.sema.maxParallel * 3);
  expect(a.sema.countRunning).toBeLessThanOrEqual(a.sema.maxParallel);
  expect(a.sema.countWaiting).toBe(0);
  await promise8;
  expect(a.ran).toBeLessThanOrEqual(a.sema.maxParallel * 3);
  expect(a.sema.countRunning).toBeLessThanOrEqual(a.sema.maxParallel);
  expect(a.sema.countWaiting).toBe(0);
  await promise9;
  expect(a.ran).toBe(9);
  expect(a.sema.countRunning).toBe(0);
  expect(a.sema.countWaiting).toBe(0);
});

test("Semaphore: Ask while another task waits and none runs", async () => {
  let sema = new Semaphore(1);
  let first = await sema.lock();
  let second = sema.lock(); // waits for `first`
  first.release();
  let third = sema.lock(); // asks before `second` continued
  (await second).release();
  (await third).release();
  expect(sema.countRunning).toBe(0);
  expect(sema.countWaiting).toBe(0);
});

test("Semaphore: Task chains that keep the queue busy", async () => {
  let sema = new Semaphore(6);
  let ran = 0;
  let maxParallelSeen = 0;
  const runChain = async (left: number) => {
    let locked = await sema.lock();
    try {
      maxParallelSeen = Math.max(maxParallelSeen, sema.countRunning);
      for (let i = 0; i < left % 5; i++) {
        await Promise.resolve(); // a deep promise chain, like a real request
      }
      ran++;
    } finally {
      locked.release();
    }
    if (left > 1) {
      await runChain(left - 1); // the response triggers the next request
    }
  };
  let chains = [];
  for (let i = 0; i < 14; i++) {
    chains.push(runChain(5));
  }
  await Promise.all(chains);
  expect(ran).toBe(14 * 5);
  expect(maxParallelSeen).toBe(6);
  expect(sema.countRunning).toBe(0);
  expect(sema.countWaiting).toBe(0);
});
