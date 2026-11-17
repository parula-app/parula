import { ArrayColl, SortedCollection } from 'svelte-collections';
import { PromiseAllDone } from '../../util/flow/PromiseAllDone';
import { RunOnce } from '../../util/flow/RunOnce';
import type { EMail } from '../EMail';
import type { Folder } from '../Folder';

export class EMailCollection<T extends EMail> extends SortedCollection<T> {
  folder: Folder;
  sortFunc: (a: T, b: T) => number;
  protected readonly readMessageRunOnce = new Map<number, RunOnce<void>>();

  constructor(folder: Folder) {
    // `sent` is null after `resetProperties()`. That sorts as 0, the oldest.
    let sortFunc = (a: T, b: T) => compareValues(b.sent?.getTime() ?? 0, a.sent?.getTime() ?? 0); // inverted = newest first
    /* Normally, a `SortedCollection` is simply a sorted /copy/ of the source collection.
     * Here, we don't use a source collection, but add the items directly to the
     * `SortedCollection`, using `.add()` and `.remove()`. The `SortedCollection`
     * has code to ensure that even those items added directly to it are also sorted. */
    super(new ArrayColl(), sortFunc);
    this.folder = folder;
  }

  /** Reads the messages from DB on-demand, as the frontend displays them. */
  getIndexRange(i: number, length: number): T[] {
    let emails = super.getIndexRange(i, length);

    if (emails.length) {
      // async: Return before filtering and reading emails
      this.readMessagesFromDB_parallel(emails)
        .catch(emails[0].folder.account.errorCallback);
    }
    return emails;
  }

  async readMessagesFromDB(emails: EMail[]) {
    let needEmails = emails.filter((email: any) => !email.haveMetadata);
    if (!needEmails.length) {
      return;
    }
    for (let email of needEmails) {
      if (email.dbID) {
        await this.readMessageOnce(email);
      }
    }
  }

  async readMessagesFromDB_parallel(emails: EMail[]) {
    let needEmails = emails.filter((email: any) => !email.haveMetadata);
    if (!needEmails.length) {
      return;
    }
    let wait = new PromiseAllDone();
    for (let email of needEmails) {
      if (email.dbID) {
        wait.add(this.readMessageOnce(email));
      }
    }
    await wait.wait();
  }

  async readMessageOnce(email: EMail) {
    let runOnceKey = email.dbID as number;
    let runOnce = this.readMessageRunOnce.get(runOnceKey);
    if (!runOnce) {
      runOnce = new RunOnce();
      this.readMessageRunOnce.set(runOnceKey, runOnce);
    }
    await runOnce.runOnce(async () => {
      try {
        await email.storage.readMessage(email);
        (email as any).haveMetadata = true;
      } finally {
        this.readMessageRunOnce.delete(runOnceKey);
      }
    });
  }

  // TODO: Move to SortedCollection in svelte-collections
  add(email: T) {
    this.addAll([email]);
  }
}

/**
 * Works for strings, numbers and `Date`s
 * @param a, b {`T extends string | number | Date`}
 * @returns
 *     `-1`: `a` before `b`
 *     `1`: `b` before `a`
 *     `0`: `a` is sorted identical to `b`
 */
function compareValues<T>(a: T, b: T): number {
  if (a < b) {
    return -1;
  } else if (a > b) {
    return 1;
  } else { // equal
    return 0;
  }
}
