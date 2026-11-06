import { EMailProcessor, ProcessingStartOn } from "../../EMailProcessor";
import type { EMail } from "../../EMail";
import { MailIdentity } from "../../MailIdentity";
import { EncryptionSystem } from "../enums";
import { SMIMEPrivateKey } from "./SMIMEPrivateKey";
import { ContentInfo, EnvelopedData, AuthEnvelopedData, Certificate, OctetString, SignedData } from "./SMIMEASN1";
import { decryptAuthEnveloped } from "./SMIMEDecrypt";
import { BlockType, unpadPKCS, decrypt } from "./SMIMERSAES";
import { verifySignedData, sameName } from "./SMIMEVerify";
import { parseMIMEDirectSubpartsBytes, parseHeaderParameters } from "../MIME";
import { UserError, assert } from "../../../util/util";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";
import type { Email as PostalEmail } from "postal-mime";

export class SMIMEReadProcessor extends EMailProcessor {
  runOn = ProcessingStartOn.Parse;
  async process(email: EMail, postal: PostalEmail) {
    // There is a direct accessor to the content type in the PostalMIME object
    // itself, but we don't have that here. And to get the headers in the
    // EMail object requires an extra parse, which seems wasteful. So
    // let's fish the header out of the PostalEmail object...
    let contentTypeHeader = sanitize.string(postal.headers.find(header => header.key == "content-type")?.value, "");
    let contentType = parseHeaderParameters(contentTypeHeader).$main;
    if (contentType == "application/pkcs7-mime" ||
        contentType == "application/x-pkcs7-mime") { // legacy type name, used by Outlook
      // The whole message is a CMS blob. It's the only body part, but fsr
      // this is an attachment.
      let cms = email.attachments.first?.content;
      if (!cms) {
        console.warn("pkcs7-mime message has no content");
        return;
      }
      let blob = new Uint8Array(await cms.arrayBuffer());
      let type;
      try {
        type = ContentInfo.decode(blob, { berToDER: true }).contentType;
      } catch (ex) {
        // Spam and broken senders label plain text as `application/pkcs7-mime`
        console.warn("pkcs7-mime message is not a CMS blob", ex);
        return;
      }
      if (type == "signedData") {
        await this.readOpaqueSigned(email, blob);
      } else if (type == "envelopedData") {
        await this.readEncrypted(email, blob);
      } else if (type == "authEnvelopedData") {
        await this.readAuthEncrypted(email, blob);
      }
    } else if (contentType == "multipart/signed") {
      await this.readClearSigned(email, contentTypeHeader);
    }
  }

  /** Decrypts an encrypted (enveloped-data) message and replaces the
   * message content with the decrypted content. */
  protected async readEncrypted(email: EMail, blob: Uint8Array) {
    email.system = EncryptionSystem.SMIME;
    let envelopedData = EnvelopedData.decode(blob, { berToDER: true });
    if (!sanitize.enum(envelopedData.content.encryptedContentInfo.contentEncryptionAlgorithm.algorithm, ["aes128cbc", "aes192cbc", "aes256cbc"], null)) {
      return;
    }
    let vector = OctetString.decode(envelopedData.content.encryptedContentInfo.contentEncryptionAlgorithm.parameters);
    let encryptedContent = envelopedData.content.encryptedContentInfo.encryptedContent;
    let symmetricKey = await this.decryptSymmetricKey(email, envelopedData.content.recipientInfos);
    let key = await crypto.subtle.importKey("raw", symmetricKey, "AES-CBC", false, ["decrypt"]);
    let decryptedContent = await crypto.subtle.decrypt({ name: "AES-CBC", iv: vector }, key, encryptedContent);
    email.wasEncrypted = true;
    await this.unwrapMIME(email, new Uint8Array(decryptedContent));
  }

  /** Decrypts a message that was encrypted with an authenticating cipher,
   * i.e. AES-GCM, and replaces the message content with the decrypted content.
   * RFC 8551 requires AES-GCM, and CMS uses it with its own content type,
   * not with the `EnvelopedData` that the AES-CBC ciphers use. */
  protected async readAuthEncrypted(email: EMail, blob: Uint8Array) {
    email.system = EncryptionSystem.SMIME;
    let authEnvelopedData = AuthEnvelopedData.decode(blob, { berToDER: true }).content;
    if (!sanitize.enum(authEnvelopedData.authEncryptedContentInfo.contentEncryptionAlgorithm.algorithm,
        ["aes128gcm", "aes192gcm", "aes256gcm"], null)) {
      return;
    }
    let symmetricKey = await this.decryptSymmetricKey(email, authEnvelopedData.recipientInfos);
    email.wasEncrypted = true;
    await this.unwrapMIME(email, await decryptAuthEnveloped(authEnvelopedData, symmetricKey));
  }

  /** Finds the private key of one of our identities that this message was
   * encrypted to, and decrypts the symmetric content key with it.
   * @throws if the message was not encrypted to any of our keys */
  protected async decryptSymmetricKey(email: EMail, recipientInfos: any[]): Promise<Uint8Array> {
    // XXX what if you were BCC'd?
    for (let recipient of email.allRecipients()) {
      let identity = MailIdentity.findIdentity(new ArrayColl([recipient]), email.folder?.account)?.identity;
      if (identity) {
        for (let privateKey of identity.encryptionPrivateKeys) {
          if (privateKey instanceof SMIMEPrivateKey) {
            let cert = Certificate.decodePEM(privateKey.certificate, { label: "CERTIFICATE" });
            let issuer = cert.tbsCertificate.issuer;
            for (let recipientInfo of recipientInfos) {
              if (recipientInfo.type != "ktri" ||
                  recipientInfo.value.keyEncryptionAlgorithm.algorithm != "rsaEncryption" ||
                  recipientInfo.value.rid.type != "issuerAndSerialNumber") {
                // TODO Support subjectKeyIdentifier
                continue;
              }
              let rid = recipientInfo.value.rid.value;
              if (rid.serialNumber != cert.tbsCertificate.serialNumber ||
                  !sameName(rid.issuer, issuer)) {
                continue;
              }
              let rawKey = await privateKey.decryptKey();
              return unpadPKCS(decrypt(recipientInfo.value.encryptedKey, rawKey), BlockType.Encrypted);
            }
          }
        }
      }
    }
    throw new UserError(gt`This message is encrypted, and the key is not available`);
  }

  /** Reads an opaque-signed message (used by Outlook), where the whole
   * message is wrapped inside the SignedData blob, instead of being sent
   * in cleartext with a detached signature (`multipart/signed`).
   * Extracts the wrapped message, so that it displays, and verifies the
   * signature over it. */
  protected async readOpaqueSigned(email: EMail, blob: Uint8Array) {
    email.system = EncryptionSystem.SMIME;
    let signedData = SignedData.decode(blob, { berToDER: true });
    let contentInfo = signedData.content.contentInfo;
    if (contentInfo.contentType != "data" || !contentInfo.content) {
      // e.g. a certs-only message, contains no message to show
      return;
    }
    let content = OctetString.decode(contentInfo.content);
    // show the msg, even if the signature is invalid
    await this.unwrapMIME(email, content);
    email.rememberSigner(await verifySignedData(signedData, content, email.received));
  }

  /** Verifies a cleartext message with a detached signature
   * (`multipart/signed`). */
  protected async readClearSigned(email: EMail, contentTypeHeader: string) {
    let signatureMimeType = email.attachments.last?.mimeType.toLowerCase();
    if (signatureMimeType != "application/pkcs7-signature" &&
        signatureMimeType != "application/x-pkcs7-signature") { // legacy type name
      return;
    }
    email.system = EncryptionSystem.SMIME;
    let parts = parseMIMEDirectSubpartsBytes(email.mime, contentTypeHeader);
    assert(parts.length == 2, "multipart/signed must have exactly 2 subparts: cleartext and signature, but got " + parts.length);
    let [clearText, signature] = parts;
    let signatureBase64 = new TextDecoder().decode(signature).split("\r\n\r\n")[1];
    if (!signatureBase64) {
      console.warn("signature part has no content");
      return;
    }
    let signedData = SignedData.decodeFromBase64(signatureBase64, { berToDER: true });
    email.rememberSigner(await verifySignedData(signedData, clearText, email.received));
  }

  /** Replaces the message with the MIME entity extracted from the CMS
   * wrapper, keeping the other message headers, and parses it. */
  protected async unwrapMIME(email: EMail, content: Uint8Array) {
    let mimeAsText = new TextDecoder().decode(email.mime);
    // Split on CRLF, but keep folded continuation lines (those starting with
    // whitespace) attached to their header.
    let otherHeaders = mimeAsText.slice(0, mimeAsText.indexOf("\r\n\r\n")).split(/\r\n(?![ \t])/).filter(header => !/^Content-/i.test(header)).join("\r\n");
    email.downloadComplete = false;
    let headerBytes = new TextEncoder().encode(otherHeaders + "\r\n");
    let mime = new Uint8Array(headerBytes.length + content.length);
    mime.set(headerBytes);
    mime.set(content, headerBytes.length);
    email.mime = mime;
    await email.parseMIME(); // checks signature recursively
    await email.saveCompleteMessage();
  }
}
