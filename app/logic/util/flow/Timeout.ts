import { waitTime } from "../util";

/**
 * Runs a function, if something takes too long.
 * Create it when you start to wait, and call `fulfilled()` once it happened.
 */
export class Timeout {
  protected timer: NodeJS.Timeout;
  protected seconds: number;
  protected readonly onTimeout: () => void;

  constructor(seconds: number, onTimeout: () => void) {
    this.seconds = seconds;
    this.onTimeout = onTimeout;
    this.timer = setTimeout(onTimeout, seconds * 1000 * waitTime.factor); // tests wait less
  }

  /** It happened in time, so do not run `onTimeout()` */
  fulfilled(): void {
    clearTimeout(this.timer);
  }

  /** It happened in time, and should happen again, e.g. a heartbeat.
   * So wait again, from now on.
   * @param seconds How long to wait, now and for later restarts. Default: as before */
  restart(seconds = this.seconds): void {
    this.seconds = seconds;
    clearTimeout(this.timer);
    this.timer = setTimeout(this.onTimeout, seconds * 1000 * waitTime.factor); // tests wait less
  }
}
