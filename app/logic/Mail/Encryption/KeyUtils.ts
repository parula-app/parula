import type { PublicKey } from "./PublicKey";
import type { PrivateKey } from "./PrivateKey";
import type { Person } from "../../Abstract/Person";
import type { PersonUID } from "../../Abstract/PersonUID";
import { PGPPrivateKey } from "./PGP/PGPPrivateKey";
import { PGPPublicKey } from "./PGP/PGPPublicKey";
import { SMIMEPrivateKey } from "./SMIME/SMIMEPrivateKey";
import { SMIMEPublicKey } from "./SMIME/SMIMEPublicKey";
import { PKCS12 } from "./SMIME/PKCS12";
import { readAutoCryptKeys } from "./PGP/AutoCrypt";
import { publicKeyFromJSON } from "./KeyFromJSON";
import { EncryptionSystem } from "./enums";
import type { EMail } from "../EMail";
import { findAllIdentities, type MailIdentity } from "../MailIdentity";
import { appGlobal } from "../../app";
import { UserError, assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export async function getPublicKeyByKeyID(id: string | null, email?: EMail): Promise<PublicKey | null> {
  if (!id) {
    return null;
  }
  if (email?.from) {
    let person = email.from.findPerson();
    if (person) {
      for (let key of person.encryptionPublicKeys.each) {
        if (key.id == id) {
          return key;
        }
      }
    }
  } else {
    for (let person of appGlobal.persons.each) {
      for (let key of person.encryptionPublicKeys.each) {
        if (key.id == id) {
          return key;
        }
      }
    }
  }
  for (let identity of findAllIdentities()) {
    for (let key of identity.encryptionPrivateKeys.each) {
      if (key.id == id) {
        return key;
      }
    }
  }
  if (email?.signedKey?.id == id) {
    return email.signedKey;
  }
  if (email?.signedKeyJSON) {
    let key = publicKeyFromJSON(email.signedKeyJSON);
    if (key.id == id) {
      email.signedKey = key;
      return key;
    }
  }
  if (email && email.system != EncryptionSystem.SMIME) {
    let key = await readAutoCryptKeys(email);
    if (key?.id == id) {
      return key;
    }
  }
  if (email) {
    // Last resort, for messages that we stored before we kept the key
    await email.loadMIME(); // calls `rememberSigner()` via processors
    if (email.signedKey?.id == id) {
      await email.saveWritablePropsLocally();
      return email.signedKey;
    }
  }
  return null;
}

/** For composer, which recipient key to use for encrypting the outgoing email */
export function getPublicKeyForPerson<T extends PublicKey>(person: Person, keyType?: new () => T): T | null {
  if (!person || person.encryptionPublicKeys.isEmpty) {
    return null;
  }
  let keys = person.encryptionPublicKeys.filterOnce(key => isUsableKey(key, keyType));
  return (keys.find(key => key.encryptByDefault) ?? keys.first) as T;
}

/** For composer, which recipient key to use for encrypting the outgoing email.
 * Also considers the key that we know only for this email address, e.g. the
 * certificate with which the recipient signed the email that we are replying to. */
export function getPublicKeyForPersonUID<T extends PublicKey>(uid: PersonUID, keyType?: new () => T): T | null {
  let saved = getPublicKeyForPerson(uid?.findPerson(), keyType);
  if (saved) {
    return saved;
  }
  let known = uid?.encryptionPublicKey;
  return isUsableKey(known, keyType) ? known : null;
}

function isUsableKey<T extends PublicKey>(key: PublicKey | null, keyType?: new () => T): key is T {
  return !!key && !key.obsolete && (!keyType || key instanceof keyType);
}

/** For composer, which own key to use for signing the outgoing email */
export function getMyPrivateKey<T extends PublicKey & PrivateKey>(identity: MailIdentity, keyType?: new () => T): T | null {
  if (!identity || identity.encryptionPrivateKeys.isEmpty) {
    return null;
  }
  let keys = identity.encryptionPrivateKeys.filterOnce(key => !key.obsolete && (!keyType || key instanceof keyType));
  return (keys.find(key => key.encryptByDefault && key.useToSign) ??
    keys.find(key => key.useToSign) ??
    keys.first) as T | null;
}

/** Whether we have an own key for this identity, e.g. an S/MIME certificate */
export function usesCrypto<T extends PublicKey & PrivateKey>(identity: MailIdentity, keyType?: new () => T): boolean {
  return !!getMyPrivateKey(identity, keyType);
}

/** For composer, which encryption system the outgoing email uses:
 * the one of the email that we answer, otherwise the one of our own key. */
export function getEncryptionSystem(mail: EMail): EncryptionSystem | null {
  return mail.system ?? getMyPrivateKey(mail.identity)?.system ?? null;
}

/**
 * Reads the key file that the user picked.
 * .p12 files, also called .pfx, are binary and encrypted, so they are
 * converted here into the PEM that `importPrivateKey()` reads.
 * @returns the contents of the file, as PEM
 */
export async function readKeyFile(file: File, passphrase: string): Promise<string> {
  let fileContents = new Uint8Array(await file.arrayBuffer());
  // PEM and ASCII armor start with the "-----BEGIN " line,
  // whereas a .p12 file starts with the ASN.1 tag for a sequence.
  if (fileContents[0] != 0x30) {
    return new TextDecoder().decode(fileContents);
  }
  let p12 = new PKCS12(passphrase);
  await p12.read(fileContents);
  return await p12.toPEM();
}

export async function importPrivateKey(fileContent: string, passphrase: string): Promise<PublicKey & PrivateKey> {
  assert(fileContent.includes("---BEGIN ") && fileContent.includes("---END "), gt`Could not find a key in this file`);
  assert(!fileContent.includes("PUBLIC KEY"), gt`This is a public key. If this is your key, you should also have the secret key in another file.`);
  if (fileContent.includes("-----BEGIN PGP PRIVATE KEY BLOCK-----")) {
    return await PGPPrivateKey.importPrivateKey(fileContent, passphrase);
  } else if (fileContent.includes("-----BEGIN PRIVATE KEY-----") ||
    fileContent.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----")) {
    return await SMIMEPrivateKey.importPrivateKey(fileContent, passphrase);
  }
  throw new UserError(gt`Could not find a key in this file`);
}

export async function importPublicKey(fileContent: string): Promise<PublicKey> {
  assert(fileContent.includes("---BEGIN ") && fileContent.includes("---END "), gt`Could not find a key in this file`);
  assert(!fileContent.includes("PRIVATE KEY"), gt`This is a secret key. If this is your key, go to Settings | Mail | Identity | Encryption and import it there.`);
  if (fileContent.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
    return await PGPPublicKey.importPublicKey(fileContent);
  } else if (fileContent.includes("-----BEGIN CERTIFICATE-----") ||
    fileContent.includes("-----BEGIN TRUSTED CERTIFICATE-----")) {
    return await SMIMEPublicKey.importPublicKey(fileContent);
  }
  throw new UserError(gt`Could not find a key in this file`);
}

export function addPublicKeyToPersonUID(uid: PersonUID, key: PublicKey) {
  let person = uid.createPerson(appGlobal.collectedAddressbook);
  assert(person, "Need person");
  person.addEncryptionPublicKey(key);
}


/**
 * Takes an armored public or private key, and returns the base64 content of it
 * Works for PGP private and public keys, and S/MIME certificates, if ASCII-armored.
 * @returns base64-encoded key
 */
export function extractBase64FromArmorned(armored: string): string {
  let lines = armored.trim().split("\n");
  assert(lines[0].startsWith("-----BEGIN"), "Not an armored key: BEGIN line missing");
  let bodyStartIndex = lines.findIndex(line => line.trim() === "") + 1;
  let footerIndex = lines.findIndex(line => line.startsWith("-----END "));
  let bodyLines = lines
    .slice(bodyStartIndex, footerIndex)
    .filter(line => !line.startsWith("=")); // exclude checksum line (starts with "=")
  return bodyLines.join("").replace(/\s/g, "");
}

/** Take base64, and add "-----BEGIN FOO ---" and "-----END FOO ----"
 * This is the opposite of `extractBase64FromArmorned()`
 * @param headerType FOO above, e.g. "PGP PUBLIC KEY BLOCK"
 * @returns the ASCII-armored key file */
export function addArmorHeader(base64: string, headerType: string) {
  return "-----BEGIN " + headerType + "-----\n\n" +
    base64 +
    "\n-----END " + headerType + "-----\n";
}
