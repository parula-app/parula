// @vitest-environment happy-dom
import "../../../../logic/app"; // first, to resolve the import cycle around Abstract/Account.ts
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { PGPPrivateKey } from "../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { SMIMEPrivateKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { getMyPrivateKey } from "../../../../logic/Mail/Encryption/KeyUtils";
import { usableDigitalIDs, keysAwaitingCertificate, setDefaultDigitalID, importDigitalID, createOpenPGPKey } from "../../../Settings/TrustCenter/DigitalIDs";
import { expect, test, vi } from "vitest";

function makeIdentity(emailAddress = "fred@example.com") {
  let account = new MailAccount();
  account.save = vi.fn(async () => {});
  let identity = new MailIdentity(account);
  identity.emailAddress = emailAddress;
  identity.realname = "Fred";
  account.identities.add(identity);
  return { account, identity };
}

function makeKey<T extends PGPPrivateKey | SMIMEPrivateKey>(key: T, id: string): T {
  key.id = id;
  key.name = id;
  key.obsolete = false; // S/MIME keys are obsolete until they have a valid certificate
  return key;
}

test("The default Digital ID signs and encrypts; the other keys of the identity don't", async () => {
  let { account, identity } = makeIdentity();
  let pgp = makeKey(new PGPPrivateKey(), "pgp");
  let smime = makeKey(new SMIMEPrivateKey(), "smime");
  pgp.useToSign = true;
  pgp.encryptByDefault = true;
  identity.encryptionPrivateKeys.addAll([pgp, smime]);
  await setDefaultDigitalID(identity, smime, true, false);
  expect(getMyPrivateKey(identity)).toBe(smime);
  expect(smime.encryptByDefault).toBe(true);
  expect(smime.useToSign).toBe(true); // encrypted messages are always signed
  expect(pgp.useToSign).toBe(false);
  expect(pgp.encryptByDefault).toBe(false);
  expect(account.save).toHaveBeenCalledOnce();
});

test("The default Digital ID stays the composer's key, also without signing by default", async () => {
  let { identity } = makeIdentity();
  let pgp = makeKey(new PGPPrivateKey(), "pgp");
  let smime = makeKey(new SMIMEPrivateKey(), "smime");
  identity.encryptionPrivateKeys.addAll([pgp, smime]);
  await setDefaultDigitalID(identity, smime, false, false);
  // getMyPrivateKey() falls back to the first key, when no key signs
  expect(getMyPrivateKey(identity)).toBe(smime);
  expect(identity.encryptionPrivateKeys.first).toBe(smime);
  expect(smime.useToSign).toBe(false);
});

test("Obsolete keys are not usable, and S/MIME keys without certificate await it", () => {
  let { identity } = makeIdentity();
  let expired = makeKey(new PGPPrivateKey(), "expired");
  expired.obsolete = true;
  let requested = makeKey(new SMIMEPrivateKey(), "requested");
  requested.obsolete = true;
  identity.encryptionPrivateKeys.addAll([expired, requested]);
  expect(usableDigitalIDs(identity)).toEqual([]);
  expect(keysAwaitingCertificate(identity)).toEqual([requested]);
});

test("Get a Digital ID creates an OpenPGP key, which Import/Export can export and import again, without duplicates", async () => {
  let { account, identity } = makeIdentity();
  let key = await createOpenPGPKey(identity);
  expect(identity.encryptionPrivateKeys.contents).toEqual([key]);
  expect(account.save).toHaveBeenCalledOnce();

  let laptop = makeIdentity().identity;
  let file = key.privateKeyAsFile();
  let imported = await importDigitalID(laptop, file, key.passphrase, " Fred's key ");
  expect(imported.id).toBe(key.id);
  expect(imported.name).toBe("Fred's key");
  await importDigitalID(laptop, file, key.passphrase, "");
  expect(laptop.encryptionPrivateKeys.contents).toEqual([imported]);
  expect(imported.name).toBe("Fred's key");
}, 30000);
