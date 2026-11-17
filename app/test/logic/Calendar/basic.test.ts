import { kCalendars } from './logins';
import { newCalendarForProtocol } from '../../../logic/Calendar/AccountsList/Calendars';
import { AuthMethod } from '../../../logic/Abstract/Account';
import { connectToBackend, stopBackend } from '../util/backend';
import { afterAll, beforeAll, expect, test } from 'vitest';

beforeAll(connectToBackend);

test.each(kCalendars)("Test $protocol calendar $username", async (config) => {
  if (config.disabled) { // <https://github.com/jestjs/jest/issues/7695>
    return;
  }
  let acc = newCalendarForProtocol(config.protocol);
  acc.username = config.username;
  acc.password = config.password;
  acc.url = config.url;
  acc.authMethod = AuthMethod.Password;

  await acc.login(false);
  await acc.listEvents();
});

afterAll(stopBackend);
