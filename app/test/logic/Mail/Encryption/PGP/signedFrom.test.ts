import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { findOrCreatePersonUID, type PersonUID } from "../../../../../logic/Abstract/PersonUID";
import { ContactEntry, type Person } from "../../../../../logic/Abstract/Person";
import { Addressbook } from "../../../../../logic/Contacts/Addressbook";
import { PGPSend } from "../../../../../logic/Mail/Encryption/PGP/PGPSend";
import { PGPPrivateKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { PGPPublicKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPublicKey";
import type { EMail } from "../../../../../logic/Mail/EMail";
import type { Folder } from "../../../../../logic/Mail/Folder";
import { expect, test, describe, beforeAll, beforeEach } from "vitest";

let folder: Folder;
let addressbook: Addressbook;
/** Sends the messages. Her key is in her contact. */
let alice: MailIdentity;
let aliceUID: PersonUID;
/** Receives the messages */
let userUID: PersonUID;
/** What nodemailer creates. It becomes the signed message. */
let innerMIME: string;

beforeAll(async () => {
  ({ folder } = await setupTestFolder({
    getMIMENodemailer: async () => new TextEncoder().encode(innerMIME.replace(/\n/g, "\r\n")),
  }));
  let user = await newIdentity("user@example.com", "User");
  folder.account.identities.add(user);
  appGlobal.emailAccounts.add(folder.account);
  userUID = findOrCreatePersonUID("user@example.com", "User");
  userUID.encryptionPublicKey = await publicKeyOf(user);
  addressbook = new Addressbook();
  appGlobal.addressbooks.add(addressbook);
  // Not added to the account: Alice is somebody else
  alice = await newIdentity("alice@example.com", "Alice");
  await newContact(alice, alice.emailAddress);
  aliceUID = findOrCreatePersonUID("alice@example.com", "Alice");
});

beforeEach(() => {
  aliceUID.encryptionPublicKey = undefined;
});

async function newIdentity(emailAddress: string, realname: string): Promise<MailIdentity> {
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = emailAddress;
  identity.realname = realname;
  identity.encryptionPrivateKeys.add(await PGPPrivateKey.createNewPrivateKey({ realname, emailAddress }));
  return identity;
}

async function publicKeyOf(identity: MailIdentity): Promise<PGPPublicKey> {
  return await PGPPublicKey.importPublicKey((identity.encryptionPrivateKeys.first as PGPPrivateKey).publicKeyArmored);
}

/** @returns the contact of the sender, with his public key */
async function newContact(sender: MailIdentity, ...emailAddresses: string[]): Promise<Person> {
  let person = addressbook.newPerson();
  person.name = sender.realname;
  for (let emailAddress of emailAddresses) {
    person.emailAddresses.add(new ContactEntry(emailAddress));
  }
  person.addEncryptionPublicKey(await publicKeyOf(sender));
  addressbook.persons.add(person);
  return person;
}

/** The sender signs with his key, and encrypts to the user, if requested.
 * @param signedHeaders of the message that the sender signs
 * @param outerFrom `From:` of the message as it arrives. The outer headers
 *   are not signed, so anybody can put anything there. */
async function sendAndReceive(signedHeaders: string, encrypt: boolean, sender = alice, outerFrom = "Alice <alice@example.com>"): Promise<EMail> {
  let sent = await send(signedHeaders, encrypt, sender);
  return await receive(`From: ${outerFrom}\r\n` + sent.replace(/^From: .*\r\n/m, ""));
}

async function send(signedHeaders: string, encrypt: boolean, sender = alice): Promise<string> {
  innerMIME = signedHeaders + kBody;
  let mail = folder.newEMail();
  mail.identity = sender;
  mail.from = findOrCreatePersonUID(sender.emailAddress, sender.realname);
  mail.to.add(userUID);
  mail.signedByKeyID = sender.encryptionPrivateKeys.first.id;
  mail.shouldEncrypt = encrypt;
  return (await PGPSend.encryptAndSign(mail)).sendRawMIME;
}

async function receive(mime: string): Promise<EMail> {
  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(mime);
  await email.parseMIME();
  return email;
}

function expectSigned(email: EMail) {
  expect(email.signedByKeyID).toBeTruthy();
  expect(email.signedByKeyID).toBe(email.signedKey?.id);
}

function expectNotSigned(email: EMail) {
  expect(email.signedByKeyID).toBe(null);
  expect(email.signedKey).toBe(null);
}

describe("PGP signed message", () => {
  test("whose signed From: is the outer From: is signed", async () => {
    let email = await sendAndReceive(kHeaders, false);
    expect(email.wasEncrypted).toBe(false);
    expectSigned(email);
    expect(aliceUID.encryptionPublicKey).toBe(email.signedKey);
  });

  test("whose signed From: is another address is not signed", async () => {
    let email = await sendAndReceive(kHeadersFromCEO, false);
    expect(email.from.emailAddress).toBe("alice@example.com");
    expectNotSigned(email);
    expect(aliceUID.encryptionPublicKey).toBeFalsy();
  });

  test("without headers in the signed part is signed", async () => {
    let email = await sendAndReceive(kContentHeaders, false);
    expectSigned(email);
  });

  test("with the contact's key for another address of the same contact is not signed", async () => {
    let bobAtHome = await newIdentity("bob@home.example", "Bob");
    let bob = await newContact(bobAtHome, "bob@example.com", "bob@home.example");

    let email = await sendAndReceive(kHeaders.replace("Alice <alice@example.com>", "Bob <bob@example.com>"), false, bobAtHome, "Bob <bob@example.com>");
    expect(email.from.findPerson()).toBe(bob);
    expectNotSigned(email);
  });
});

describe("PGP encrypted and signed message", () => {
  test("whose signed From: is the outer From: is signed", async () => {
    let email = await sendAndReceive(kHeaders, true);
    expect(email.wasEncrypted).toBe(true);
    expectSigned(email);
  });

  test("whose signed From: is another address is not signed", async () => {
    let email = await sendAndReceive(kHeadersFromCEO, true);
    expect(email.wasEncrypted).toBe(true);
    // The reader shows the From: of the decrypted message
    expect(email.from.emailAddress).toBe("ceo@example.com");
    expectNotSigned(email);
    expect(aliceUID.encryptionPublicKey).toBeFalsy();
  });
});

describe("PGP message that was signed, then encrypted without signing again", () => {
  test("is signed", async () => {
    let signedMIME = await send(kHeaders, false);
    let openPGP = await import("openpgp");
    let encrypted = await openPGP.encrypt({
      message: await openPGP.createMessage({ text: signedMIME }),
      encryptionKeys: await (userUID.encryptionPublicKey as PGPPublicKey).openPGPPublicKey(openPGP),
    });
    let email = await receive(kEncryptedHeaders + encrypted + "\r\n--encrypted--\r\n");
    expect(email.wasEncrypted).toBe(true);
    expectSigned(email);
  });
});

const kContentHeaders = `Content-Type: text/plain; charset=utf-8
`;

const kHeaders = `From: Alice <alice@example.com>
To: User <user@example.com>
Subject: Signed
Message-ID: <pgp-signed-from@example.com>
Date: Tue, 14 Jul 2026 10:00:00 +0000
MIME-Version: 1.0
` + kContentHeaders;

const kHeadersFromCEO = kHeaders.replace("From: Alice <alice@example.com>", "From: CEO <ceo@example.com>");

const kBody = `
Hello
`;

const kEncryptedHeaders = [
  "From: Alice <alice@example.com>",
  "To: User <user@example.com>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="encrypted"',
  "",
  "--encrypted",
  "Content-Type: application/pgp-encrypted",
  "",
  "Version: 1",
  "",
  "--encrypted",
  'Content-Type: application/octet-stream; name="encrypted.asc"',
  "",
  "",
].join("\r\n");
