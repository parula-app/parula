import { SendEncrypted } from "../SendEncrypted";
import type { EMail } from "../../EMail";
import { getMyPrivateKey, getPublicKeyForPersonUID } from "../KeyUtils";
import { CreateMIME } from "../../SMTP/CreateMIME";
import { PGPPublicKey } from "./PGPPublicKey";
import { PGPPrivateKey } from "./PGPPrivateKey";
import { sendAutoCryptHeader } from "./AutoCrypt";
import { splitMIMEHeaders, kLineBreak, newBoundary } from "../MIME";
import { NotReached, assert } from "../../../util/util";
import { gt } from "../../../../l10n/l10n";
import type OpenPGP from "openpgp";
import type { HeaderLine } from "postal-mime";

export class PGPSend {
  /**
   * Called before sending email, if PGP is to be used.
   * Encrypts and signs the message, as requested.
   * The user must have a usable private key, otherwise mail throws.
   * If encryption is requested, all recipients must have usable public keys,
   * otherwise mail throws. The caller is responsible to ensure that.
   *
   * @returns a new email that is encrypted and/or signed.
   *   The original email is untouched.
   */
  static async encryptAndSign(mail: EMail, recipients = mail.allRecipients()): Promise<EMail> {
    let privateKey = getMyPrivateKey(mail.identity, PGPPrivateKey);
    assert(privateKey, gt`Please first set up PGP encryption for yourself, in Settings | Mail | Identity | Encryption`);
    let result = SendEncrypted.cloneEMail(mail);
    let originalMIME = await CreateMIME.getMIME(mail);
    let originalMIMEStr = new TextDecoder().decode(originalMIME);
    originalMIMEStr = originalMIMEStr.replace(/User-Agent: [^\r]+\r\n/, "");
    let { headers } = await splitMIMEHeaders(originalMIMEStr);
    let openPGP = await import("openpgp");
    let privateOpenPGPKey = await privateKey.openPGPPrivateKey();
    if (mail.shouldEncrypt) {
      let message = await openPGP.createMessage({ text: await PGPSend.protectHeaders(originalMIMEStr) });
      let recipientKeys = recipients.contents.flatMap(puid =>
        getPublicKeyForPersonUID(puid, PGPPublicKey));
      let recipientOpenPGPKeys: OpenPGP.PublicKey[] = [];
      for (let recipientKey of recipientKeys) {
        recipientOpenPGPKeys.push(await recipientKey.openPGPPublicKey(openPGP));
      }
      recipientOpenPGPKeys.push(await privateKey.openPGPPublicKey(openPGP));
      let encrypted = await openPGP.encrypt({
        message: message,
        signingKeys: privateOpenPGPKey,
        encryptionKeys: recipientOpenPGPKeys,
      });
      result.sendRawMIME = PGPSend.createMIMEForEncrypted(mail, headers, encrypted, privateKey);
    } else if (mail.signedByKeyID) {
      let message = await openPGP.createMessage({ text: originalMIMEStr });
      let signature = await openPGP.sign({
        message: message,
        signingKeys: privateOpenPGPKey,
        detached: true,
      });

      const inHeader = false;
      if (inHeader) {
        result.sendRawMIME = PGPSend.createMIMEForSignedInHeader(mail, headers, originalMIMEStr, signature, privateKey);
      } else {
        result.sendRawMIME = PGPSend.createMIMEForSignedDetached(mail, headers, originalMIMEStr, signature, privateKey);
      }
    } else {
      throw new NotReached();
    }
    result.signedByKeyID = privateKey.id;
    return result;
  }

  static createMIMEHeader(mail: EMail, headers: HeaderLine[], privateKey: PGPPrivateKey): string[] {
    return [
      `MIME-Version: 1.0`,
      `Date: ` + toRFC822DateString(new Date()),
      ...copyHeaders(headers, ["from", "to", "cc"]),
      ...this.wrapHeader(sendAutoCryptHeader(mail.identity, privateKey)),
    ];
  }

  static createMIMEForEncrypted(mail: EMail, headers: HeaderLine[], encryptedMessage: string, privateKey: PGPPrivateKey): string {
    // RFC 3156 Sec 4 <https://www.rfc-editor.org/rfc/rfc3156>
    let boundary = newBoundary();
    let mime = [
      ...PGPSend.createMIMEHeader(mail, headers, privateKey),
      `Subject: PGP encrypted message`,
      `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted";`,
      ` boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: application/pgp-encrypted`,
      `Content-Description: PGP/MIME version identification`,
      ``,
      `Version: 1`,
      ``,
      `--${boundary}`,
      `Content-Type: application/octet-stream; name="encrypted.asc"`,
      `Content-Disposition: inline; filename="encrypted.asc"`,
      `Content-Description: OpenPGP encrypted message`,
      ``,
      encryptedMessage,
      ``,
      `--${boundary}--`,
    ].join(kLineBreak);
    return mime;
  }

  /**
   * Wraps the message in a `multipart/mixed; protected-headers="v1"` and moves the
   * `Subject` and other headers into that part, so that they are encrypted.
   * <https://www.ietf.org/archive/id/draft-autocrypt-lamps-protected-headers-02.html>
   */
  static async protectHeaders(mime: string): Promise<string> {
    let { headers, body } = await splitMIMEHeaders(mime);
    let messageHeaders: string[] = []; // Protected, e.g. From, To, Subject, Date, Message-ID
    let contentHeaders: string[] = []; // Describe the body and stay with it, e.g. Content-Type
    for (let header of headers) {
      if (header.key.startsWith("content-")) {
        contentHeaders.push(header.line);
      } else if (header.key == "mime-version") {
        // stays on the outer message only
      } else {
        messageHeaders.push(header.line);
      }
    }

    let boundary = newBoundary();
    return [
      `Content-Type: multipart/mixed; protected-headers="v1"; boundary="${boundary}"`,
      ...messageHeaders,
      ``,
      `--${boundary}`,
      ...contentHeaders,
      ``,
      body.replace(/(\r\n)+$/, ""), // trim trailing newlines
      `--${boundary}--`,
      ``,
    ].join(kLineBreak);
  }

  static createMIMEForSignedDetached(mail: EMail, headers: HeaderLine[], message: string, signature: string, privateKey: PGPPrivateKey): string {
    // RFC 3156 Sec 5 <https://www.rfc-editor.org/rfc/rfc3156>
    let boundary = newBoundary();
    let mime = [
      ...PGPSend.createMIMEHeader(mail, headers, privateKey),
      ...copyHeaders(headers, ["subject"]),
      `Content-Type: multipart/signed; protocol="application/pgp-signature"; micalg=pgp-sha512;`,
      ` boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      message,
      `--${boundary}`,
      `Content-Type: application/pgp-signature; name="signature.asc"`,
      `Content-Disposition: inline; filename="signature.asc"`,
      ``,
      signature.replaceAll("\n", kLineBreak),
      ``,
      `--${boundary}--`,
    ].join(kLineBreak);
    return mime;
  }

  static createMIMEForSignedInHeader(mail: EMail, headers: HeaderLine[], message: string, signature: string, privateKey: PGPPrivateKey): string {
    // <https://www.ietf.org/archive/id/draft-gallagher-email-unobtrusive-signatures-02.html#name-sig-header-field>

    // need to add `hp=clean` *sigh*
    let msgLines = message.split(kLineBreak);
    for (let i = 0; i < msgLines.length; i++) {
      let msgLine = msgLines[i];
      if (msgLine.startsWith("Content-Type: ")) {
        if (msgLine.endsWith(";")) {
          msgLine += ` hp="clear";`;
        } else {
          msgLine += `; hp="clear"`;
        }
        msgLines[i] = msgLine;
        break; // first only
      }
    }

    let boundary = newBoundary();
    let mime = [
      ...PGPSend.createMIMEHeader(mail, headers, privateKey),
      ...copyHeaders(headers, ["subject"]),
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      ...this.wrapHeader(`Sig: t=p; b=` + btoa(signature)),
      ...msgLines,
      `--${boundary}--`,
    ].join(kLineBreak);
    return mime;
  }

  protected static wrapHeader(content: string): string[] {
    const maxWidth = 78;
    let lines: string[] = [];
    for (let i = 0; i < content.length; i += maxWidth) {
      lines.push((i == 0 ? "" : "    ") + content.slice(i, i + maxWidth + (i == 0 ? 0 : -4)));
    }
    return lines;
  }

  /* import { MimeNode } from "mime-model";
  static createMIMEForEncryptedViaMIMEModel(mail: EMail, encryptedMessage: Uint8Array): Uint8Array {
    let msg = MimeNode.create(
      `multipart/encrypted; protocol="application/pgp-encrypted"`,
      { defaultHeaders: true });
    function recipient(p: PersonUID): { name: string, address: string } {
      return { name: p.name, address: p.emailAddress };
    }
    msg.from = recipient(mail.from);
    msg.to = mail.to.contents.map(p => recipient(p));
    msg.cc = mail.cc.contents.map(p => recipient(p));
    msg.subject = "PGP encrypted message";

    // Part 1: version marker
    const versionNode = MimeNode.create(null);
    versionNode.setHeaders([
      `Content-Type: application/pgp-encrypted`,
      `Content-Description: PGP/MIME version identification`,
    ]);
    versionNode.content = Buffer.from(`Version: 1\r\n`);

    // Part 2: encrypted message
    const encryptedNode = MimeNode.create(null);
    encryptedNode.setHeaders([
      `Content-Type: application/octet-stream; name="encrypted.asc"`,
      `Content-Disposition: inline; filename="encrypted.asc"`,
      `Content-Description: OpenPGP encrypted message`,
    ]);
    encryptedNode.content = encryptedMessage;

    msg.appendChild(versionNode);
    msg.appendChild(encryptedNode);
    return msg.serialize()
  }*/
}

export function toRFC822DateString(date: Date) {
  return "" +
    date.toLocaleString("en-gb", {
      weekday: "short",
      timeZone: "UTC",
    }) +
    ", " +
    date.toLocaleString("en-gb", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }) +
    " " +
    date.toLocaleString("en-gb", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
      timeZone: "UTC",
    }) +
    " +0000";
}

/** @param keys the header names that should be copied. All other headers are not copied. */
function copyHeaders(headers: HeaderLine[], keys: string[]): string[] {
  return headers.filter(header => keys.includes(header.key)).map(header => header.line);
}
