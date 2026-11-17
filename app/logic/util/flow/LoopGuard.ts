/**
 * Stops a loop whose end depends on the server, so that a buggy or hostile server
 * cannot keep us busy forever:
 * - after a maximum number of rounds, or
 * - when a round got the same from the server as the round before.
 * Both report through `onStop()`.
 *
 * ```
 * let loop = new LoopGuard(1000, () =>
 *   this.errorCallback(new Error("The server keeps returning more emails. Stopped.")));
 * while (loop.nextRound()) {
 *   let page = await this.fetchPage();
 *   if (!page.length) {
 *     return;
 *   }
 *   if (loop.isSameAsLastRound(page.map(email => email.id).join(" "))) {
 *     return;
 *   }
 *   ...
 * }
 * ```
 */
export class LoopGuard {
  protected readonly maxRounds: number;
  protected readonly onStop: () => void;
  protected round = 0;
  protected lastProgress: string | null = null;

  /**
   * @param maxRounds How many rounds the loop may run at most
   * @param onStop Runs when the guard stops the loop, to report it. May throw.
   */
  constructor(maxRounds: number, onStop: () => void) {
    this.maxRounds = maxRounds;
    this.onStop = onStop;
  }

  /** Call at the start of each round.
   * @returns false, if the loop already ran `maxRounds` rounds. Then end the loop. */
  nextRound(): boolean {
    if (this.round >= this.maxRounds) {
      this.onStop();
      return false;
    }
    this.round++;
    return true;
  }

  /**
   * @param progress What this round got from the server,
   *   e.g. the IDs on this page, the sync state, or the URL of the next page
   * @returns true, if it's the same as in the round before. Then end the loop.
   */
  isSameAsLastRound(progress: string): boolean {
    if (progress == this.lastProgress) {
      this.onStop();
      return true;
    }
    this.lastProgress = progress;
    return false;
  }
}
