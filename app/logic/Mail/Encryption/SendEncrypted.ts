import type { EMail } from "../EMail";
import type { PersonUID } from "../../Abstract/PersonUID";
import { getMyPrivateKey, getPublicKeyForPersonUID } from "./KeyUtils";
import { PGPSend } from "./PGP/PGPSend";
import { PGPPublicKey } from "./PGP/PGPPublicKey";
import { PGPPrivateKey } from "./PGP/PGPPrivateKey";
import { SMIMESend } from "./SMIME/SMIMESend";
import { SMIMEPublicKey } from "./SMIME/SMIMEPublicKey";
import { SMIMEPrivateKey } from "./SMIME/SMIMEPrivateKey";
import { UserError, assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

export class SendEncrypted {
  /**
   * Encrypts and signs the email as needed, based on flags
   * `mail.shouldEncrypt` and `mail.signed` .
   * If no encryption nor signing needed, returns the input `mail` object.
   * Otherwise, checks the recipients, whether we have keys for them, and
   * determines whether to use PGP or S/MIME, and calls the appropriate implementation.
   * @returns the same or a new mail object, with the same content, but encrypted and/or signed
   */
  static async encryptAsNeeded(mail: EMail): Promise<EMail> {
    if (mail.mustEncrypt) {
      assert(mail.shouldEncrypt, "shouldEncrypt must be set whenever mustEncrypt is set");
    }

    // TODO Use `mail.encryptionSystem` variable to determine how to encrypt
    let privateKey = getMyPrivateKey(mail.identity);
    if (mail.shouldEncrypt) {
      assert(mail.bcc.isEmpty, "Cannot encrypt with BCC recipients"); // TODO send BCC as separate email
      // If the user wants encryption, then use all applicable keys. `encryptByDefault` is only for the default.
      assert(privateKey, gt`Please first set up encryption for yourself, in Settings | Mail | Identity | Encryption`);
      let recipients = new ArrayColl<PersonUID>(mail.allRecipients());
      if (getMyPrivateKey(mail.identity, PGPPrivateKey) &&
          recipients.every(puid => getPublicKeyForPersonUID(puid, PGPPublicKey))) {
        return await PGPSend.encryptAndSign(mail);
      } else if (getMyPrivateKey(mail.identity, SMIMEPrivateKey) &&
          recipients.every(puid => getPublicKeyForPersonUID(puid, SMIMEPublicKey))) {
        return await SMIMESend.encryptAndSign(mail);
      } else {
        throw new UserError(gt`Cannot encrypt to all recipients using PGP or S/MIME`);
      }
    } else if (mail.signedByKeyID) {
      if (privateKey instanceof PGPPrivateKey) {
        return await PGPSend.encryptAndSign(mail);
      } else if (privateKey instanceof SMIMEPrivateKey) {
        return await SMIMESend.encryptAndSign(mail);
      } else {
        throw new UserError(gt`Please first set up encryption and create a signing key for yourself, in Settings | Mail | Identity | Encryption`);
      }
    } else {
      return mail;
    }
  }

  /** Encrypts only to ourselves, because the recipients may not have keys yet */
  static async encryptDraft(mail: EMail): Promise<EMail> {
    let privateKey = getMyPrivateKey(mail.identity);
    let noRecipients = new ArrayColl<PersonUID>();
    if (privateKey instanceof PGPPrivateKey) {
      return await PGPSend.encryptAndSign(mail, noRecipients);
    } else if (privateKey instanceof SMIMEPrivateKey) {
      return await SMIMESend.encryptAndSign(mail, noRecipients);
    } else {
      throw new UserError(gt`Please first set up encryption for yourself, in Settings | Mail | Identity | Encryption`);
    }
  }

  static cloneEMail(mail: EMail): EMail {
    let result = mail.folder.newEMail();
    // <copied from="EMail.copyFrom()">, because we want to copy only the delivery properties, not the content
    result.id = mail.id;
    result.folder = mail.folder;
    result.identity = mail.identity;
    result.from = mail.from;
    result.replyTo = mail.replyTo;
    result.to.replaceAll(mail.to);
    result.cc.replaceAll(mail.cc);
    result.bcc.replaceAll(mail.bcc);
    result.tags.replaceAll(mail.tags);
    result.isDraft = mail.isDraft;
    // </copied>

    result.wasEncrypted = mail.wasEncrypted;
    result.signedByKeyID = mail.signedByKeyID;
    return result;
  }
}
