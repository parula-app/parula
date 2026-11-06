import { Throttle } from '../../../../logic/util/flow/Throttle';
import { waitTime } from '../../../../logic/util/util';
import { expect, test } from 'vitest';

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
