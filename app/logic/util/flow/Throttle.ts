import { sleep, waitTime } from "../util";

/**
 * Limits the number of tasks per second.
 */
export class Throttle {
  /** For each of the `maxTasks` slots, when the next task may start in it,
   * in milliseconds like `Date.now()`, earliest first */
  protected nextTime: number[];
  protected perSecond = 1; // in seconds

  /**
   * @param maxTasks max count of tasks per interval
   * @param perSecond interval, in seconds
   */
  constructor(maxTasks: number, perSecond: number) {
    this.perSecond = perSecond;
    this.nextTime = new Array(maxTasks).fill(0);
  }

  async throttle(): Promise<void> {
    let now = Date.now();
    let nextTime = Math.max(now, this.nextTime.shift() ?? 0);
    this.nextTime.push(nextTime + this.perSecond * 1000);
    let waitFor = nextTime - now;
    if (waitFor > 0) {
      console.log(`Throttling for ${waitFor}ms because there were ${this.nextTime.length} connections in the last ${this.perSecond} second`);
      await sleep(waitFor / 1000 * waitTime.factor); // tests wait less
    }
  }

  /** Delays the next task until `seconds` from now. */
  waitForSecond(seconds: number) {
    this.nextTime[0] = Math.max(this.nextTime[0] ?? 0, Date.now() + seconds * 1000);
  }

  get maxTasks(): number {
    return this.nextTime.length;
  }
  set maxTasks(max: number) {
    let oldMax = this.nextTime.length;
    if (max == oldMax) {
      return;
    }
    this.nextTime.length = max;
    if (oldMax < max) {
      this.nextTime.fill(0, oldMax);
    }
  }
}
