import { sleep } from "../../../logic/util/util";

/**
 * Waits for what the test is actually waiting for, instead of for a fixed delay.
 * A fixed delay is either too short on a loaded machine, and the test fails
 * although the code is right, or too long, and every run pays for it.
 * @param condition may read the database, and then returns a promise
 * @throws if `condition` did not come true in time
 */
export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutSec = 10): Promise<void> {
  const kPollSec = 0.005;
  for (let end = Date.now() + timeoutSec * 1000; Date.now() < end; ) {
    if (await condition()) {
      return;
    }
    await sleep(kPollSec);
  }
  throw new Error(`Timed out after ${timeoutSec} s waiting for: ${condition}`);
}
