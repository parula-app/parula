import { appGlobal } from '../app';
import { Person } from '../Abstract/Person';
import { WebMailBackend } from './backend';
import { login } from './config';
import type { Account } from '../Abstract/Account';
import { gLicense } from '../util/License';
import { createCollectedAddressbook } from '../Contacts/AccountsList/Addressbooks';
import { createPersonalCalendar } from '../Calendar/AccountsList/Calendars';
import { readSavedSearches } from '../Mail/Virtual/SavedSearchFolder';
import { loadTagsList } from '../Abstract/Tag';
import { getComputerOn } from '../util/backend-wrapper';
import { logErrorToServer } from '../util/error';

// Before anything reads it, @see `startup.ts`
appGlobal.me = new Person();

export async function getStartObjects(): Promise<void> {
  gLicense.license = { valid: true }; // Proprietary, see comment in License.ts
  appGlobal.remoteApp = new WebMailBackend();
  appGlobal.collectedAddressbook = await createCollectedAddressbook();
  appGlobal.personalAddressbook = appGlobal.collectedAddressbook;
  appGlobal.addressbooks.add(appGlobal.collectedAddressbook);
  appGlobal.calendars.add(await createPersonalCalendar());

  await loadTagsList(); // before the accounts: their filter rules reference the tags
  await login();

  readSavedSearches();
}

/**
 * Logs in to all accounts for which we have the credentials stored.
 *
 * @param startupErrorCallback Called for login errors.
 *   May be called multiple times, e.g. once per account.
 */
export async function loginOnStartup(startupErrorCallback: (ex: Error) => void): Promise<void> {
  for (let account of appGlobal.chatAccounts) {
    account.errorCallback = (ex) => backgroundErrorInAccount(ex, account);
    if (!account.isDependentAccount) {
      account.loginAndStartup(false)
        .catch(startupErrorCallback);
    }
  }

  for (let account of appGlobal.emailAccounts) {
    account.errorCallback = (ex) => backgroundErrorInAccount(ex, account);
    account.loginAndStartup(false)
      .catch(startupErrorCallback);
  }
}

/** On wake up */
function checkAccounts(): void {
  for (let account of appGlobal.chatAccounts) {
    if (!account.isLoggedIn && !account.isDependentAccount) {
      account.loginAndStartup(false)
        .catch(account.errorCallback);
    }
  }
  for (let account of appGlobal.emailAccounts) {
    if (account.isLoggedIn) {
      account.inbox?.getNewMessages()
        .catch(account.errorCallback);
    } else {
      account.loginAndStartup(false)
        .catch(account.errorCallback);
    }
  }
}

/** When
 * - the computer resumes from sleep, or
 * - the browser resumes our page, or
 * - the network comes back up,
 * log in again and check for new mail. */
export function checkWakeUp(): void {
  let wasSleeping = false;
  let computerOn = getComputerOn();
  computerOn.subscribe(() => {
    if (wasSleeping && !computerOn.isSleeping && navigator.onLine) {
      checkAccounts();
    }
    // If the network is still down here, the `online` event below follows
    wasSleeping = computerOn.isSleeping;
  });
  window.addEventListener("online", checkAccounts); // network is back up
}

function backgroundErrorInAccount(ex: Error, account: Account) {
  account.errors.add(ex);
  console.error(ex);
  logErrorToServer(ex);
}
