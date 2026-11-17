import { EMailProcessor, ProcessingStartOn } from "../../EMailProcessor";
import { EMail } from "../../EMail";
import { PGPPrivateKey } from "./PGPPrivateKey";
import { PGPPublicKey, type OpenPGPModule } from "./PGPPublicKey";
import { readAutoCryptKeys } from "./AutoCrypt";
import { EncryptionSystem } from "../enums";
import { parseMIMEDirectSubparts, parseHeaderParameters, toCRLF } from "../MIME";
import { MailIdentity, findIdentityForEMailAddress } from "../../MailIdentity";
import type { PersonUID } from "../../../Abstract/PersonUID";
import type { Attachment } from "../../../Abstract/Attachment";
import { k1HourMS } from "../../../util/date";
import { UserError, assert } from "../../../util/util";
import { gt } from "../../../../l10n/l10n";
import { ArrayColl, Collection } from "svelte-collections";
import type { Email as MIME } from "postal-mime";
import type OpenPGP from "openpgp";

/*
https://github.com/openpgpjs/openpgpjs?tab=readme-ov-file#encrypt-and-decrypt-uint8array-data-with-a-password
https://github.com/openpgpjs/sop-openpgpjs
https://gitlab.com/enigmail/npgpjs/-/blob/main/lib/decrypt.js?ref_type=heads
https://mailman3.ietf.org/mailman3/lists/openpgp@ietf.org/
*/

const isLogging = true;

export class PGPReadProcessor extends EMailProcessor {
  runOn = ProcessingStartOn.Parse;
  async process(email: EMail, mime: MIME) {
    let encrypted = attachmentOfType(email, "application/pgp-encrypted")?.content &&
      attachmentOfType(email, "application/octet-stream")?.content;
    let detachedSignaturePart = attachmentOfType(email, "application/pgp-signature");
    let detachedSignature = detachedSignaturePart?.content;
    if (!encrypted && !detachedSignature) {
      return;
    }
    email.system = EncryptionSystem.PGP;
    let openPGP = await import("openpgp");
    if (isLogging) console.log("MIME", mime, "encrypted", encrypted);
    let outerFrom = email.from.emailAddress;
    let senderPublicKeys = await this.getPublicKeysForEmailAddress(email.from, email.sent, email);
    let senderOpenPGPKeys: OpenPGP.PublicKey[] = [];
    for (let publicKey of senderPublicKeys) {
      senderOpenPGPKeys.push(await publicKey.openPGPPublicKey(openPGP));
    }
    if (encrypted) {
      let privateKeys = new ArrayColl<OpenPGP.PrivateKey>();
      for (let recipient of email.allRecipients()) {
        let identity = MailIdentity.findIdentity(new ArrayColl([recipient]), email.folder?.account)?.identity;
        privateKeys.addAll(await this.getPrivateKeysForIdentity(identity));
      }
      if (privateKeys.isEmpty) {
        throw new UserError(gt`This message is encrypted, and the key is not available`);
      }
      let armored = await encrypted.text();
      let encryptedMessage = await openPGP.readMessage({ armoredMessage: armored });
      let decryptedResult = await openPGP.decrypt({
        message: encryptedMessage,
        decryptionKeys: privateKeys.contents,
        format: "binary",
        verificationKeys: senderOpenPGPKeys,
        date: email.sent,
      });
      email.wasEncrypted = true;
      let signer: PGPPublicKey | null = null;
      if (decryptedResult.signatures?.length) {
        signer = await this.checkSignatures(decryptedResult.signatures, senderPublicKeys, email.sent, openPGP);
      }
      // TODO If inner MIME doesn't contain headers, keep the outer ones
      await this.updateMIME(email, decryptedResult.data, outerFrom, signer);
    } else if (detachedSignature) { // why `else`: don't overwrite the signature within the encrypted part
      await email.parseHeaders();
      let signedPart = getSignedCleartext(email);
      if (!signedPart) {
        return;
      }
      signedPart = toCRLF(signedPart);
      let signedBinary = new TextEncoder().encode(signedPart);
      let signedContent = await openPGP.createMessage({ binary: signedBinary });
      let signature = await openPGP.readSignature({
        armoredSignature: await detachedSignature.text(),
      });
      let verificationResult = await openPGP.verify({
        message: signedContent,
        signature,
        verificationKeys: senderOpenPGPKeys,
        format: "binary",
        // date: email.sent, // TODO plus a few minutes. Getting "Signature creation time is in the future"
      });
      let signer = await this.checkSignatures(verificationResult.signatures, senderPublicKeys, email.sent, openPGP);
      let innerFrom = (await EMail.getHeadersFromMIME(signedBinary)).from;
      email.rememberSigner(!innerFrom || innerFrom.address?.toLowerCase() == email.from.emailAddress.toLowerCase() ? signer : null);
      email.attachments.remove(detachedSignaturePart);
    }
  }

  async checkSignatures(signatures: OpenPGPVerificationResult[], senderPublicKeys: Collection<PGPPublicKey>, forDate: Date, openPGP: OpenPGPModule): Promise<PGPPublicKey | null> {
    let validSignatures = new ArrayColl<OpenPGPVerificationResult>();
    for (let sig of signatures) {
      try {
        await sig.verified; // throws for invalid signature
        let sigg = await sig.signature;
        let packet = sigg.packets[0]; // there's only one in our cases
        if (Math.abs(packet.created.getTime() - forDate.getTime()) > 1 * k1HourMS) {
          continue;
        }
        validSignatures.add(sig);
      } catch (ex) {
        if (isLogging) {
          console.error(ex);
        }
      }
    }

    for (let sig of validSignatures.each) {
      // TODO senders not in my addressbook (never replied)
      for (let publicKey of senderPublicKeys.each) {
        let openPGPPublicKey = await publicKey.openPGPPublicKey(openPGP);
        if (sig.keyID.equals(openPGPPublicKey.getKeyID())) {
          return publicKey;
        }
      }
    }
    return null;
  }

  /** Replace the email with this new decrypted email */
  async updateMIME(email: EMail, content: Uint8Array, outerFrom: string, signer: PGPPublicKey | null) {
    email.downloadComplete = false;
    email.mime = content;
    email.resetProperties();
    await email.parseMIME();
    if (email.from.emailAddress.toLowerCase() != outerFrom.toLowerCase()) {
      // Treat as phishing
      console.warn("PGP signature ignored, because inner signed From: is", email.from.emailAddress, "but outer header From: is", outerFrom);
      email.rememberSigner(null);
    } else if (signer) { // else keep a signature that parseMIME() found inside
      email.rememberSigner(signer);
    }
    await email.saveCompleteMessage();
  }

  async getPrivateKeysForIdentity(identity: MailIdentity): Promise<Collection<OpenPGP.PrivateKey>> {
    let result = new ArrayColl<OpenPGP.PrivateKey>();
    for (let privateKey of identity.encryptionPrivateKeys.each) {
      if (!(privateKey instanceof PGPPrivateKey)) {
        continue;
      }
      result.add(await privateKey.openPGPPrivateKey());
    }
    return result;
  }

  async getPublicKeysForEmailAddress(personUID: PersonUID, date: Date, email?: EMail): Promise<Collection<PGPPublicKey>> {
    let keys = new ArrayColl<PGPPublicKey>();
    let person = personUID.findPerson();
    if (person) {
      for (let publicKey of person.encryptionPublicKeys.each) {
        if (!(publicKey instanceof PGPPublicKey && publicKey.publicKeyArmored)) {
          continue;
        }
        keys.add(publicKey);
      }
    }
    let myself = findIdentityForEMailAddress(personUID.emailAddress);
    if (myself) {
      for (let privateKey of myself.encryptionPrivateKeys.each) {
        if (!(privateKey instanceof PGPPrivateKey && privateKey.publicKeyArmored)) {
          continue;
        }
        keys.add(privateKey);
      }
    } else if (email && keys.isEmpty) {
      let publicKey = await readAutoCryptKeys(email);
      if (publicKey) {
        keys.add(publicKey);
      }
    }
    return keys;
  }
}

/** @param mimeType must be lowercase. MIME types are case-insensitive,
 * RFC 2045 section 5.1 */
function attachmentOfType(email: EMail, mimeType: string): Attachment | undefined {
  return email.attachments.find(a => a.mimeType.toLowerCase() == mimeType);
}

/** @returns null, if the signature is not the main content of the email,
 * but nested, e.g. a mailing list wrapped the signed message */
function getSignedCleartext(email: EMail): string | null {
  assert(email.headers.length > 0, "parseHeaders first");
  let contentType = email.headers.get("content-type");
  let parameters = parseHeaderParameters(contentType);
  if (parameters.$main != "multipart/signed" ||
      parameters.protocol?.toLowerCase() != "application/pgp-signature") {
    return null;
  }
  let parts = parseMIMEDirectSubparts(email.mime, contentType);
  assert(parts.length == 2, "multipart/signed must have exactly 2 subparts: cleartext and signature, but got " + parts.length);
  return parts[0];
}

type OpenPGPVerificationResult = {
  keyID: OpenPGP.KeyID,
  verified: Promise<boolean>,
  signature: Promise<OpenPGP.Signature>,
};
