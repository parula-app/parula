import { kMailAccounts } from './logins';
import { connectToBackend, stopBackend } from '../util/backend';
import { setupTestMailAccount } from './setup';
import { assert } from '../../../logic/util/util';
import { afterAll, beforeAll, test } from 'vitest';

beforeAll(connectToBackend);

test.each(kMailAccounts)("Test $protocol account $username", async (config) => {
  if (config.disabled) { // <https://github.com/jestjs/jest/issues/7695>
    return;
  }
  let acc = await setupTestMailAccount(config); // login is part of the test objective
  assert(acc.inbox, "Need inbox");
  let newMsgs = await acc.inbox.listMessages();
  console.log("msgs", newMsgs.getIndexRange(0, 10).map(msg => msg.subject));
  await acc.inbox.downloadMessages(newMsgs);
});

afterAll(stopBackend);
