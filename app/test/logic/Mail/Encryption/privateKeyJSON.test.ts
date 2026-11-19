// The key classes use the app singleton. Importing it first breaks the
// import cycle, which would otherwise leave the base classes undefined.
import "../../../../logic/app";
import { setupTestFolder } from "../SQL/setup";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { PGPPrivateKey } from "../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { SMIMEPrivateKey } from "../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { TrustLevel } from "../../../../logic/Mail/Encryption/enums";
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

test("The public key of our key has our name and trust, but no secret key", async () => {
  for (let key of [
    await PGPPrivateKey.createNewPrivateKey({ realname: "User", emailAddress: "user@example.com" }),
    await SMIMEPrivateKey.createNewPrivateKey("user@example.com"),
  ]) {
    key.name = "My key";
    key.trustLevel = TrustLevel.Personal;
    let publicKey = key.publicKey();
    expect(publicKey).not.toBeInstanceOf(key.constructor);
    expect(publicKey.id).toBe(key.id);
    expect(publicKey.name).toBe("My key");
    expect(publicKey.trustLevel).toBe(TrustLevel.Personal);
    expect(JSON.stringify(publicKey)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(publicKey)).not.toContain(key.passphrase);
  }
});
