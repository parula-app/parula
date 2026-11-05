import type { OWAAccount } from "../OWAAccount";
import { Timeout } from "../../../util/flow/Timeout";
import { isTransientError } from "../../../util/netUtil";
import { AbstractFunction } from "../../../util/util";

export class OWANotifications {
  account: OWAAccount;
  /** Ends this listener, e.g. when a newer one took over, or on logout */
  protected readonly abort = new AbortController();
  /** The server sends something regularly, also when nothing changed. Without it,
   * the connection is dead, e.g. after a VPN drop, which doesn't always end the stream,
   * or the listener ended with an error that goes away by itself.
   * The subclasses restart it whenever something arrived. */
  protected readonly watchdog: Timeout;
  protected isReconnect: boolean;

  constructor(account: OWAAccount, isReconnect: boolean) {
    this.account = account;
    this.isReconnect = isReconnect;
    this.watchdog = new Timeout(90, () => this.account.listenForNotifications(true));
  }

  /** Runs until it fails or we stop it, so don't `await` it.
   * @throws only errors that won't go away by themselves */
  async start(): Promise<void> {
    try {
      await this.listen();
    } catch (ex) {
      if (this.abort.signal.aborted) {
        return;
      }
      if (isTransientError(ex)) {
        this.watchdog.restart(); // e.g. it failed while we processed a notification, which pauses the watchdog
        return;
      }
      this.stop();
      throw ex;
    }
  }

  protected async listen(): Promise<never> {
    throw new AbstractFunction();
  }

  /** Call when the server accepted the stream */
  protected connected(): void {
    if (this.isReconnect) {
      this.isReconnect = false;
      this.account.fetchChangesMissedByNotifications()
        .catch(this.account.errorCallback);
    }
  }

  stop(): void {
    this.watchdog.fulfilled();
    this.abort.abort();
  }
}
