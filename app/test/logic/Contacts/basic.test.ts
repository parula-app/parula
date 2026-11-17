import { kAddressbooks } from './logins';
import { newAddressbookForProtocol } from '../../../logic/Contacts/AccountsList/Addressbooks';
import { AuthMethod } from '../../../logic/Abstract/Account';
import { connectToBackend, stopBackend } from '../util/backend';
import { afterAll, beforeAll, expect, test } from 'vitest';

beforeAll(connectToBackend);

test.each(kAddressbooks)("Test $protocol addressbook $username", async (config) => {
  if (config.disabled) { // <https://github.com/jestjs/jest/issues/7695>
    return;
  }
  let acc = newAddressbookForProtocol(config.protocol);
  acc.username = config.username;
  acc.password = config.password;
  acc.url = config.url;
  acc.authMethod = AuthMethod.Password;

  await acc.login(false);
  await acc.listContacts();
});

afterAll(stopBackend);
