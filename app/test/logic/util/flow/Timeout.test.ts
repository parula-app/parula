import { Timeout } from '../../../../logic/util/flow/Timeout';
import { sleep, waitTime } from '../../../../logic/util/util';
import { expect, test } from 'vitest';

waitTime.factor = 1; // these tests check the real timing of `Timeout`

test("Timeout runs, when it takes too long", async () => {
  let ran = false;
  new Timeout(0.1, () => ran = true);
  await sleep(0.2);
  expect(ran).toBe(true);
});

test("Timeout does not run, when it was fulfilled", async () => {
  let ran = false;
  let timeout = new Timeout(0.1, () => ran = true);
  await sleep(0.05);
  timeout.fulfilled();
  await sleep(0.2);
  expect(ran).toBe(false);
});
