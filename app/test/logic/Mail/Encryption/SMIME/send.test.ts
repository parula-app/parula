import "../../../../../logic/app";
import { setupTestFolder, newTestEMail } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { findOrCreatePersonUID } from "../../../../../logic/Abstract/PersonUID";
import { SMIMESend } from "../../../../../logic/Mail/Encryption/SMIME/SMIMESend";
import { SMIMEPrivateKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { SMIMEPublicKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { EncryptionSystem } from "../../../../../logic/Mail/Encryption/enums";
import { CreateMIME } from "../../../../../logic/Mail/SMTP/CreateMIME";
import type { EMail } from "../../../../../logic/Mail/EMail";
import { Folder, SpecialFolder } from "../../../../../logic/Mail/Folder";
import { expect, test, describe, beforeAll } from "vitest";

// The browser has these, but Node does not.
globalThis.window ??= globalThis as any;
globalThis.indexedDB ??= {
  cmp(a: Uint8Array, b: Uint8Array): number {
    let length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] != b[i]) {
        return a[i] < b[i] ? -1 : 1;
      }
    }
    return Math.sign(a.length - b.length);
  },
} as any;

let folder: Folder;
let identity: MailIdentity;
let key: SMIMEPrivateKey;

beforeAll(async () => {
  ({ folder } = await setupTestFolder({
    // Stands in for nodemailer in the backend, which writes a message in
    // plain text, without attachments, as a single quoted-printable part,
    // and a `raw` message as it is.
    getMIMENodemailer: async (mail: any) => new TextEncoder().encode(mail.raw ?? kPlainTextMIME.replace(/\n/g, "\r\n")),
    getCACertificates: async () => [],
  }));
  identity = new MailIdentity(folder.account);
  identity.emailAddress = "user@example.com";
  identity.realname = "User";
  folder.account.identities.add(identity);
  appGlobal.emailAccounts.add(folder.account);
  key = await SMIMEPrivateKey.importPrivateKey(kPrivateKey + "\n" + kCertificate);
  identity.encryptionPrivateKeys.add(key);
  findOrCreatePersonUID("user@example.com", "User").encryptionPublicKey =
    await SMIMEPublicKey.importPublicKey(kCertificate);
});

/** Sends the message to ourselves, and reads it, as the recipient would. */
async function sendAndReceive(sign: boolean, encrypt: boolean): Promise<EMail> {
  let mail = folder.newEMail();
  mail.identity = identity;
  mail.from = findOrCreatePersonUID("user@example.com", "User");
  mail.to.add(mail.from);
  mail.signedByKeyID = sign ? key.id : null;
  mail.shouldEncrypt = encrypt;
  let sent = await SMIMESend.encryptAndSign(mail);

  let received = newTestEMail(folder, "plain-text@example.com");
  received.mime = new TextEncoder().encode(sent.sendRawMIME);
  await received.parseMIME();
  return received;
}

describe("A plain-text message that we send with S/MIME arrives as written", () => {
  test("signed", async () => {
    let email = await sendAndReceive(true, false);
    expect(email.text.replace(/\r\n/g, "\n").trim()).toBe(kText);
    expect(email.signedByKeyID).toBe(key.id);
  });

  test("encrypted", async () => {
    let email = await sendAndReceive(false, true);
    expect(email.wasEncrypted).toBe(true);
    expect(email.text.replace(/\r\n/g, "\n").trim()).toBe(kText);
  });

  test("signed and encrypted", async () => {
    let email = await sendAndReceive(true, true);
    expect(email.wasEncrypted).toBe(true);
    expect(email.text.replace(/\r\n/g, "\n").trim()).toBe(kText);
    expect(email.signedByKeyID).toBe(key.id);
  });
});

describe("An encrypted draft", () => {
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

  /** To a recipient whose certificate we don't have yet */
  async function saveDraft(): Promise<Uint8Array> {
    let mail = folder.newEMail();
    mail.identity = identity;
    mail.from = findOrCreatePersonUID("user@example.com", "User");
    mail.to.add(findOrCreatePersonUID("no-certificate@example.com", "No Certificate"));
    mail.shouldEncrypt = true;
    await mail.compose.saveAsDraft();
    return savedMIME;
  }

  test("is saved without the text in clear", async () => {
    let mime = new TextDecoder().decode(await saveDraft());
    expect(mime).not.toContain("K=C3=B6ln");
    expect(mime).not.toContain("Zeile");
  });

  test("reopens with its text, and with encryption on", async () => {
    let draft = drafts.newEMail();
    draft.mime = await saveDraft();
    await draft.parseMIME(); // as the download does
    await draft.compose.editDraft();
    expect(draft.system).toBe(EncryptionSystem.SMIME);
    expect(draft.wasEncrypted).toBe(true);
    expect(draft.text.replace(/\r\n/g, "\n").trim()).toBe(kText);
    expect(draft.shouldEncrypt).toBe(true);
  });
});

const kText = "Grüße aus Köln!\nEine sehr lange Zeile, eine sehr lange Zeile, eine sehr lange Zeile, eine sehr lange Zeile.";

/** As nodemailer writes `kText`. The `Content-Transfer-Encoding` must stay
 * with the body, or the recipient sees the quoted-printable codes. */
const kPlainTextMIME = `From: User <user@example.com>
To: User <user@example.com>
Subject: Plain text
Message-ID: <plain-text@example.com>
Content-Transfer-Encoding: quoted-printable
Date: Tue, 14 Jul 2026 10:00:00 +0000
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Gr=C3=BC=C3=9Fe aus K=C3=B6ln!
Eine sehr lange Zeile, eine sehr lange Zeile, eine sehr lange Zeile, eine =
sehr lange Zeile.
`;

/* openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 7300 -nodes \
 *   -subj "/CN=User" -addext "subjectAltName=email:user@example.com" \
 *   -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
 *   -addext "extendedKeyUsage=emailProtection"
 * Test key only. Do not use it for anything else. */
const kPrivateKey = `
-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCg+HVercx4/8yG
GhZk+9WI3Llhimc6ZZAyTg6pUIjfuBxRGmyICFndRVTWbyl/epi42SUwwf9v23yC
YNIhnco+ZfVz7n5DrFDpllBsPsRIucfORsm+Azgt3IiHOgDFoqDkzjZX/fXNhAsy
RTVBpivFU7vO1tXycrzXn4p4mveOJJOCUROBcK+Dk3YuLWucTPaORmd1vzKaiJR1
QXQpwFVymkk2RtnNhZ8UpsYEZcNE17OIMFUBXjPtjcZvQMzwu4J+Ow//OXU7Hi+/
ApnopRrWPDI8XO6jUpqclQXwOFKGZmLlV2Dl5FKD3pLMsrcb/K5NWNNBaoUICIx6
PT9klUBpAgMBAAECggEAEtVJnicwGiQLgNEX4lQYj/0LGh9q+R5y4tUryqF9MiJE
pd81PYEvSmqB2jOCo8NAj7f62EaKT+2vwUKksywr7RBZdGk95UW0PcV0FAYP9FZQ
IJE6/1E5xxvbRBRZjMX8lGiQBnbUcGl3ieJ7sE+fJWTTlLKhW3lodhiDcfLnmH39
fcA5bAN83vglgAcyfUMy718hToJe5kPkCqOI+gEnrbM3jX5JmyO7dWgOVGufeH5y
3VbXZhXP4VfBI6P/orgtNPtIrwt+Ei4leCj3ukQKT4w27M3fRCWpxCVcDygRKyBn
mC+xCa69bc2ZUXYJzIxzGaqbamGA6mgklUbNaAc9pQKBgQDTbVXyrA8XkiSs77pV
ChR8kn7Jk+eRJcA3lfEH+EzvH5cNSX7z95WE4yMN+9nu80Hv1ISk/ayNrd16JURo
+M8AF9x+O41sYhpi0bTQaPPJg2zcrW/EB3wjwOgvlQbWUpIoDz80ksf8q6Pkes4J
XCsptxhACGWshVOVLyrsutKwuwKBgQDC5/75HgudZz5b/vrd4xVE2Ig26vIJiRPr
GBu9X0ljIpUxgbmxozvtJliaViOZVMgfTOpaPBPUmIhLpDcQfPz+bVeO5KnfJa+w
LoQn66EYOSmNXpmbkTkadeV6HPSwFE3Bqp11HjMlYc4GTbryjSPOY/WB4llfITcN
khKfcpgjKwKBgGQ29v5Hv/+ULf4qw097r6o8Zgx2JtUN58ZxNAZrE0xk1NxfceWB
/UU3xG3karBwbViYiycJdrjRKKG0+HApPzT0GndbEvXEqm0cqW//z049FWSkcM2i
Hp1z2ppzMQJ1sQF7+KGa0WBamxy5eN/G6E6lksEHOepEaBHWgaokA6nxAoGAeCex
hj5Bhs3pIam1WijuKb0bbE+22q4I+3unTj157oWZWCXTJnGtNevX332PAK3FmZY/
O1WiHAPUsl0QHTgQd4FM4yiQmKKRBpoGmt2mOFq1BRP2unLysx9PUtKa/hnmPahC
3bq6aSc8baJpx7G/CzOQXHwAAKdnWxRcKrPomnUCgYB6Y4JtD6q6aUwm4RAUiB85
DMEl0wLJJvc9MqtmtRpBEtRB7Z9DKdN36qxwSedlaBlKalbf58/MZCjy5/lOOwtt
iKysjTjNbEgnZrqGRofBPGbQEy0ZjurN0xSZ+d1Kd8zzCntRzIV+mh9FE4X4w6hC
bYn+Ns3lcasPfSLaA+3Q0Q==
-----END PRIVATE KEY-----
`;

const kCertificate = `
-----BEGIN CERTIFICATE-----
MIIDQzCCAiugAwIBAgIUb4AQAhcKQjSe/6HbGdla+zIbHngwDQYJKoZIhvcNAQEL
BQAwDzENMAsGA1UEAwwEVXNlcjAeFw0yNjEwMTMwMjIyMTdaFw00NjEwMDgwMjIy
MTdaMA8xDTALBgNVBAMMBFVzZXIwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQCg+HVercx4/8yGGhZk+9WI3Llhimc6ZZAyTg6pUIjfuBxRGmyICFndRVTW
byl/epi42SUwwf9v23yCYNIhnco+ZfVz7n5DrFDpllBsPsRIucfORsm+Azgt3IiH
OgDFoqDkzjZX/fXNhAsyRTVBpivFU7vO1tXycrzXn4p4mveOJJOCUROBcK+Dk3Yu
LWucTPaORmd1vzKaiJR1QXQpwFVymkk2RtnNhZ8UpsYEZcNE17OIMFUBXjPtjcZv
QMzwu4J+Ow//OXU7Hi+/ApnopRrWPDI8XO6jUpqclQXwOFKGZmLlV2Dl5FKD3pLM
srcb/K5NWNNBaoUICIx6PT9klUBpAgMBAAGjgZYwgZMwHQYDVR0OBBYEFHs3bnNf
zv55RCVR18Wtnv9Ckl3yMB8GA1UdIwQYMBaAFHs3bnNfzv55RCVR18Wtnv9Ckl3y
MA8GA1UdEwEB/wQFMAMBAf8wGwYDVR0RBBQwEoEQdXNlckBleGFtcGxlLmNvbTAO
BgNVHQ8BAf8EBAMCBaAwEwYDVR0lBAwwCgYIKwYBBQUHAwQwDQYJKoZIhvcNAQEL
BQADggEBAAwpTuPpyoj+4R9q7JDXWuaREUA4FdvAiwHGrVXMSRMlp7Bs+TB6fmtV
euI6hbzzYJjW52rvnOfBx84TbvkhMK4UcF4VRkW4L/LHMRbo/L4zj1GR9wniRF8D
1nmg1rtTbkqImfDa75SaLS8kdpppQeDr+yCveSKX9zzL8Q42PDkztPBAG3giH1Tq
T4kx59oxeGIqyMSsuMjV5CTNXravlzLyueIaj7Fil+G2FdToaGQI4qhxJbPU0POQ
+cCV8SpoT1xYHhAYWI4cADuCWkM4pR4hin4Th7tQ1a0xWRh+3SYvN3qe7bYhb4Y3
C/N31HBqD0x7M8ywO6Efs76izHRSTLY=
-----END CERTIFICATE-----
`;
