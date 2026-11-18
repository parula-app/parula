import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { findOrCreatePersonUID } from "../../../../../logic/Abstract/PersonUID";
import { PGPSend } from "../../../../../logic/Mail/Encryption/PGP/PGPSend";
import { PGPPrivateKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { PGPPublicKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPublicKey";
import { readAutoCryptKeys } from "../../../../../logic/Mail/Encryption/PGP/AutoCrypt";
import { EncryptionSystem } from "../../../../../logic/Mail/Encryption/enums";
import { CreateMIME } from "../../../../../logic/Mail/SMTP/CreateMIME";
import { JSONEMail } from "../../../../../logic/Mail/JSON/JSONEMail";
import type { EMail } from "../../../../../logic/Mail/EMail";
import { Folder, SpecialFolder } from "../../../../../logic/Mail/Folder";
import { expect, test, describe, beforeAll } from "vitest";

let folder: Folder;
let identity: MailIdentity;
let key: PGPPrivateKey;

beforeAll(async () => {
  ({ folder } = await setupTestFolder({
    // Stands in for nodemailer in the backend, which writes a `raw` message as it is
    getMIMENodemailer: async (mail: any) => new TextEncoder().encode(mail.raw ?? kMIME.replace(/\n/g, "\r\n")),
  }));
  identity = new MailIdentity(folder.account);
  identity.emailAddress = "user@example.com";
  identity.realname = "User Müller";
  folder.account.identities.add(identity);
  appGlobal.emailAccounts.add(folder.account);
  key = await PGPPrivateKey.createNewPrivateKey({ realname: "User Müller", emailAddress: "user@example.com" });
  identity.encryptionPrivateKeys.add(key);
  findOrCreatePersonUID("user@example.com", "User Müller").encryptionPublicKey =
    await PGPPublicKey.importPublicKey(key.publicKeyArmored);
});

/** Signs the message to ourselves, and encrypts it, if requested.
 * @returns the MIME source that goes to the server */
async function send(encrypt: boolean): Promise<string> {
  let mail = folder.newEMail();
  mail.identity = identity;
  mail.from = findOrCreatePersonUID("user@example.com", "User Müller");
  mail.to.add(mail.from);
  mail.subject = kSubject;
  mail.signPrivateKey = key;
  mail.shouldEncrypt = encrypt;
  return (await PGPSend.encryptAndSign(mail)).sendRawMIME;
}

/** Reads the message, as the recipient would */
async function receive(mime: string): Promise<EMail> {
  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(mime);
  await email.parseMIME();
  return email;
}

describe("PGP message with non-ASCII sender name and a long subject", () => {
  // EWS and OWA upload the message with `btoa()`, which throws for anything
  // outside of Latin-1, e.g. "–" or "€", and garbles the other non-ASCII characters.
  test("signed: the message is plain ASCII, as Exchange needs it", async () => {
    let mime = await send(false);
    expect(mime).toMatch(/^[\x00-\x7F]*$/);
  });

  test("encrypted: the message is plain ASCII, as Exchange needs it", async () => {
    let mime = await send(true);
    expect(mime).toMatch(/^[\x00-\x7F]*$/);
  });

  test("signed: the recipient sees the subject and sender as written", async () => {
    let email = await receive(await send(false));
    expect(email.subject).toBe(kSubject);
    expect(email.from.name).toBe("User Müller");
    expect(email.signedPublicKeyFingerprint).toBe(key.fingerprint);
  });

  test("encrypted: the recipient sees the subject and sender as written", async () => {
    let email = await receive(await send(true));
    expect(email.wasEncrypted).toBe(true);
    expect(email.subject).toBe(kSubject);
    expect(email.from.name).toBe("User Müller");
    expect(email.signedPublicKeyFingerprint).toBe(key.fingerprint);
  });
});

describe("PGP message with our key in the AutoCrypt header", () => {
  test("gives the recipient our whole public key, although the header spans several lines", async () => {
    let email = await receive(await send(false));
    let headerKey = await readAutoCryptKeys(email);
    expect(headerKey?.fingerprint).toBe(key.fingerprint);
  });
});

describe("PGP message signed with the key that the composer chose", () => {
  test("is signed with that key, not with our default key", async () => {
    let defaultKey = await PGPPrivateKey.createNewPrivateKey({ realname: "User Müller", emailAddress: "user@example.com" });
    defaultKey.useToSign = true;
    identity.encryptionPrivateKeys.add(defaultKey);
    try {
      let email = await receive(await send(false)); // `send()` chooses `key`
      expect(email.signedPublicKeyFingerprint).toBe(key.fingerprint);
    } finally {
      identity.encryptionPrivateKeys.remove(defaultKey);
    }
  });
});

describe("A draft", () => {
  let drafts: Folder;
  let savedMIME: Uint8Array;

  beforeAll(() => {
    drafts = new Folder(folder.account);
    drafts.specialFolder = SpecialFolder.Drafts;
    // Keeps what an IMAP server would get
    drafts.addMessage = async (message: EMail) => {
      savedMIME = message.mime ?? await CreateMIME.getMIME(message);
    };
    folder.account.rootFolders.add(drafts);
  });

  /** To a recipient whose key we don't have yet */
  async function saveDraft(encrypt: boolean): Promise<Uint8Array> {
    let mail = folder.newEMail();
    mail.identity = identity;
    mail.from = findOrCreatePersonUID("user@example.com", "User Müller");
    mail.to.add(findOrCreatePersonUID("no-key@example.com", "No Key"));
    mail.subject = kSubject;
    mail.shouldEncrypt = encrypt;
    await mail.compose.saveAsDraft();
    return savedMIME;
  }

  test("that we sign is saved with the fingerprint of the key that signs, not the key, and reads back with that key", async () => {
    let mail = folder.newEMail();
    mail.identity = identity;
    mail.from = findOrCreatePersonUID("user@example.com", "User Müller");
    mail.sent = mail.received = new Date();
    mail.signPrivateKey = key; // as the composer does
    let saved = JSON.stringify(JSONEMail.save(mail));
    expect(saved).toContain(key.fingerprint);
    expect(saved).not.toContain("PRIVATE KEY");
    expect(saved).not.toContain(key.passphrase);

    let reread = folder.newEMail();
    JSONEMail.readExtraData(reread, JSON.parse(saved));
    expect(reread.signPrivateKey).toBe(key);
  });

  test("that is encrypted is saved without the text in clear", async () => {
    let mime = new TextDecoder().decode(await saveDraft(true));
    expect(mime).not.toContain("K=C3=B6ln");
  });

  test("that is encrypted reopens with its subject and text, and must stay encrypted and signed", async () => {
    let draft = drafts.newEMail();
    draft.mime = await saveDraft(true);
    await draft.parseMIME(); // as the download does
    await draft.compose.editDraft();
    expect(draft.system).toBe(EncryptionSystem.PGP);
    expect(draft.wasEncrypted).toBe(true);
    expect(draft.subject).toBe(kSubject);
    expect(draft.text.trim()).toBe("Grüße aus Köln!");
    expect(draft.shouldEncrypt).toBe(true);
    expect(draft.mustEncrypt).toBe(true);
    expect(draft.signPrivateKey).toBe(key);
  });

  test("that is not encrypted reopens with encryption optional", async () => {
    let draft = drafts.newEMail();
    draft.mime = await saveDraft(false);
    await draft.parseMIME();
    await draft.compose.editDraft();
    expect(draft.wasEncrypted).toBe(false);
    expect(draft.mustEncrypt).toBe(false);
  });
});

/** Longer than a header line may be, so it must be folded, and only between words */
const kSubject = "Grüße aus Köln – ein Betreff, der deutlich länger ist als achtundsiebzig Zeichen";

/** As nodemailer 7 writes the message */
const kMIME = `From: =?UTF-8?Q?User_M=C3=BCller?= <user@example.com>
To: =?UTF-8?Q?User_M=C3=BCller?= <user@example.com>
Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_K=C3=B6ln_=E2=80=93_?=
 =?UTF-8?Q?ein_Betreff=2C_der_deutlich_l=C3=A4nger_?=
 =?UTF-8?Q?ist_als_achtundsiebzig_Zeichen?=
Message-ID: <pgp-headers@example.com>
Date: Tue, 14 Jul 2026 10:00:00 +0000
Content-Transfer-Encoding: quoted-printable
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Gr=C3=BC=C3=9Fe aus K=C3=B6ln!
`;
