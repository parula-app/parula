/**
 * Runs a task, and if it's called again while the task runs, runs it once more afterwards.
 * Many calls during one run result in only one more run.
 * E.g. a sync after the server reported changes.
 */
export class RunAgain {
  protected readonly maxRounds: number;
  protected running = false;
  protected again = false;

  /** @param maxRounds Stops after so many runs in a row */
  constructor(maxRounds: number) {
    this.maxRounds = maxRounds;
  }

  /** While the task runs, returns right away, and the task runs once more */
  async run(func: () => Promise<void>): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      for (let round = 1; round <= this.maxRounds; round++) {
        this.again = false;
        await func();
        if (!this.again) {
          return;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
