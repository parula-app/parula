import { Throttle } from '../../../../logic/util/flow/Throttle';
import { waitTime } from '../../../../logic/util/util';
import { expect, test, vi } from 'vitest';

waitTime.factor = 1; // these tests check the real timing of `Throttle`

class WithThrottle {
  throttle = new Throttle(3, 0.1);
  ran = 0;
  async run() {
    await this.throttle.throttle();
    this.ran++;
  }
}

test("Throttle", async () => {
  let a = new WithThrottle();
  let startTime = Date.now()
  await a.run();
  await a.run();
  await a.run();
  expect(Date.now()).toBeLessThanOrEqual(startTime + 10);
  await a.run();
  await a.run();
  await a.run();
  expect(Date.now()).toBeGreaterThanOrEqual(startTime + 100);
});

test("Wait for", async () => {
  let a = new WithThrottle();
  let startTime = Date.now()
  await a.run();
  expect(Date.now()).toBeLessThanOrEqual(startTime + 10);
  a.throttle.waitForSecond(0.1);
  await a.run();
  expect(Date.now()).toBeGreaterThanOrEqual(startTime + 100);
});

test("A task that had to wait counts from when it ran, not from when it asked", async () => {
  // E.g. reconnecting while the network is down: each attempt fails at once
  let throttle = new Throttle(1, 0.2);
  let times: number[] = [];
  for (let i = 0; i < 4; i++) {
    await throttle.throttle();
    times.push(Date.now());
  }
  for (let i = 1; i < times.length; i++) {
    expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(190);
  }
});

test("In tests, every wait is shortened, not only the first", async () => {
  // E.g. more than 1000 Graph requests in a row: the later waits must not add up to the real interval
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); // exact times, no timer jitter
  const kTestWaitFactor = 0.1;
  waitTime.factor = kTestWaitFactor;
  try {
    let throttle = new Throttle(1, 1);
    let times: number[] = [];
    let running = (async () => {
      for (let i = 0; i < 5; i++) {
        await throttle.throttle();
        times.push(Date.now());
      }
    })();
    await vi.runAllTimersAsync();
    await running;

    let shortenedIntervalMS = 1000 * kTestWaitFactor;
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(shortenedIntervalMS);
      expect(times[i] - times[i - 1]).toBeLessThan(1.5 * shortenedIntervalMS);
    }
  } finally {
    waitTime.factor = 1;
    vi.useRealTimers();
  }
});
