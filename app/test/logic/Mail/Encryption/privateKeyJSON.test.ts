// The key classes use the app singleton. Importing it first breaks the
// import cycle, which would otherwise leave the base classes undefined.
import "../../../../logic/app";
import { setupTestFolder } from "../SQL/setup";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { PGPPrivateKey } from "../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { SMIMEPrivateKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { expect, test } from "vitest";

test("Our secret key is saved only with the identity, not where a public key is saved", async () => {
  let { folder } = await setupTestFolder();
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = "user@example.com";
  identity.realname = "User";
  identity.encryptionPrivateKeys.add(await PGPPrivateKey.createNewPrivateKey({ realname: "User", emailAddress: "user@example.com" }));
  identity.encryptionPrivateKeys.add(await SMIMEPrivateKey.createNewPrivateKey("user@example.com"));

  for (let key of identity.encryptionPrivateKeys) {
    let json = JSON.stringify(key); // as with a mail or a contact
    expect(json).toContain(key.id);
    expect(json).not.toContain("PRIVATE KEY");
    expect(json).not.toContain(key.passphrase);
  }

  let loaded = new MailIdentity(folder.account);
  loaded.fromConfigJSON(JSON.parse(JSON.stringify(identity.toConfigJSON())));
  expect(loaded.encryptionPrivateKeys.length).toBe(2);
  for (let [i, key] of loaded.encryptionPrivateKeys.contents.entries()) {
    let original = identity.encryptionPrivateKeys.getIndex(i);
    expect(await key.privateKeyAsFile().text()).toBe(await original.privateKeyAsFile().text());
    expect(key.passphrase).toBe(original.passphrase);
  }
});
