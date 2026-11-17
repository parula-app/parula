import { SMLHTTPAccount } from '../../../../logic/Mail/SML/SMLHTTPAccount';
import { MailIdentity } from '../../../../logic/Mail/MailIdentity';
import { setupTestMailAccount } from '../setup';
import { kMailAccounts } from '../logins';
import { connectToBackend, stopBackend } from '../../util/backend';
import { appGlobal } from '../../../../logic/app';
import { afterAll, beforeAll, expect, test } from 'vitest';

/** Attention: Slow. Typically takes 15 seconds, or more */
async function accountSetup() {
  await connectToBackend();
  if (!appGlobal.remoteApp) { // no dev backend, so all tests here are skipped, see util/backend
    return;
  }
  let config = kMailAccounts[0];
  if (!config) {
    throw new Error("Please define test accounts in test/logic/Mail/logins.ts");
  }
  let mailAccount = await setupTestMailAccount(config);
  await registerSMLHTTP(mailAccount.identities.first);
}

beforeAll(accountSetup, 30000);
afterAll(stopBackend);

let acc: SMLHTTPAccount;

/**
 * Registers an SML HTTP account, if not yet done.
 *
 * @warning Waits for email, so often takes minutes or hangs entirely. Do not `await` it.
 */
async function registerSMLHTTP(identity: MailIdentity) {
  acc = await SMLHTTPAccount.getOrCreateAccount(identity);
  if (!acc.isLoggedIn) {
    acc.mailAccount = identity.account;
    await acc.login(); // waits for email, so often takes minutes or hangs entirely
  }
}

test("SML HTTP resource REST API", async () => {
  let bundle = crypto.randomUUID();
  let mainRes = crypto.randomUUID();
  let mainContent = { "question": "abs" };
  let { resourceURL: mainURL } = await acc.saveResource(bundle, mainRes, false, mainContent);
  let userRes = crypto.randomUUID();
  let userContent = { "answer": 1 };
  let { resourceURL: userURL } = await acc.saveResource(bundle, userRes, true, userContent);

  let mainContentResponse = await SMLHTTPAccount.getURL(mainURL);
  expect(mainContentResponse.question).toBe(mainContent.question);
  let userContentResponse = await SMLHTTPAccount.getURL(userURL);
  expect(userContentResponse.answer).toBe(userContent.answer);

  let userContentChanged = { "answer": 2 };
  await SMLHTTPAccount.saveURL(userURL, userContentChanged);
  let userContentChangedResponse = await SMLHTTPAccount.getURL(userURL);
  expect(userContentChangedResponse.answer).toBe(userContentChanged.answer);

  let mainContentChanged = { "question": "2" };
  await expect(async () => {
    await SMLHTTPAccount.saveURL(mainURL, mainContentChanged);
  }).rejects.toThrowError();
  let { resourceURL: mainURLChanged } = await acc.saveResource(bundle, mainRes, false, mainContentChanged);
  let mainContentChangedResponse = await SMLHTTPAccount.getURL(mainURL);
  expect(mainContentChangedResponse.question).toBe(mainContentChanged.question);
  expect(mainURL).toBe(mainURLChanged);
});
