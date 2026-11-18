import { PGPPublicKey } from "./PGPPublicKey";
import type { PGPPrivateKey } from "./PGPPrivateKey";
import { TrustLevel } from "../enums";
import type { EMail } from "../../EMail";
import type { MailIdentity } from "../../MailIdentity";
import { addArmorHeader, extractBase64FromArmorned, isConfirmedKey } from "../KeyUtils";
import { parseHeaderParameters } from "../MIME";
import { appGlobal } from "../../../app";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../../util/util";

/** @returns the AutoCrypt header, i.e. `AutoCrypt: addr=; ...; keydata=...` */
export function sendAutoCryptHeader(identity: MailIdentity, privateKey: PGPPrivateKey): string {
  assert(privateKey.publicKeyArmored, `Need armored public key of private key ${privateKey.name} for ${identity.emailAddress}`);
  let parts: string[] = [ "addr=" + identity.emailAddress ];
  if (privateKey.encryptByDefault) {
    parts.push("prefer-encrypt=mutual");
  }
  let keydata = extractBase64FromArmorned(privateKey.publicKeyArmored); // definitely not `.privateKeyArmorned` ;-)
  parts.push(`keydata=${keydata}`); // keydata must be last, per spec
  let header = "AutoCrypt: " + parts.join("; ");
  return header;
}

/** Reads the AutoCrypt keys from the sender of this email. */
export async function readAutoCryptKeys(mail: EMail): Promise<PGPPublicKey> {
  await mail.loadMIME();
  await mail.parseHeaders();
  let header = sanitize.nonemptystring(mail.headers.get("autocrypt"), null);
  let params = header ? parseHeaderParameters(header) : null;
  if (!header ||
      !params?.keydata ||
      sanitize.emailAddress(params.addr, null) != mail.from?.emailAddress) {
    return null;
  }
  let preferEncrypted = params["prefer-encrypt"] == "mutual";

  let publicKeyArmored = addArmorHeader(
    sanitize.nonemptystring(params.keydata), "PGP PUBLIC KEY BLOCK");
  let publicKey = await PGPPublicKey.importPublicKey(publicKeyArmored);
  publicKey.trustLevel = TrustLevel.Sender;
  publicKey.encryptByDefault = preferEncrypted;
  return publicKey;
}

/** Reads the AutoCrypt keys from the sender of this email,
 * and adds them to the contact.
 * If the contact does not exist yet, creates the contact in the
 * collected addressbook. */
export async function importAutoCryptKeys(mail: EMail) {
  let publicKey = await readAutoCryptKeys(mail);
  if (!publicKey) {
    return;
  }
  let preferEncrypted = publicKey.encryptByDefault;

  let person = mail.from.createPerson(appGlobal.collectedAddressbook);
  let existing = person.encryptionPublicKeys.find(key => key.id == publicKey.id);
  if (existing) {
    // Anybody can send this header, so it must not change a key that the user or a CA confirmed
    if (existing.encryptByDefault != preferEncrypted && !isConfirmedKey(existing)) {
      existing.encryptByDefault = preferEncrypted;
      await person.save();
    }
  } else {
    person.encryptionPublicKeys.add(publicKey);
    await person.save();
  }
}
