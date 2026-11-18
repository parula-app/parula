import { appGlobal } from "../app";
import { minorError } from "../util/error";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { encrypt, decrypt } from 'password-salt';

// Only for passwords from older versions, and where the OS has no key store for us.
const secret = 'anything'; // Lib adds a 32-byte salt, which acts as password
// 32^256 values should be sufficient against rainbow tables
const kOSPrefix = "os:"; // encrypted by the OS key store, @see `encryptWithOS()` in the backend

export async function passwordDecrypt(encrypted: string | null | undefined): Promise<string | null> {
  if (encrypted == null) {
    return null;
  }
  if (encrypted.startsWith(kOSPrefix)) {
    try {
      encrypted = await appGlobal.remoteApp.decryptWithOS(encrypted.substring(kOSPrefix.length));
    } catch (ex) {
      // The OS lost our key, e.g. when the profile moved to another computer. The user needs to enter the password again.
      minorError(ex);
      return null;
    }
  }
  return sanitize.string(await decrypt(secret, encrypted) as string, null);
}

export async function passwordEncrypt(password: string | null | undefined): Promise<string | null> {
  if (password == null) {
    return null;
  }
  let encrypted = await encrypt(secret, password);
  return await passwordEncryptWithOS(encrypted) ?? encrypted;
}

/**
 * For passwords that are only obfuscated, because older versions saved them,
 * or because the OS key store was not available at that time.
 * @returns `encrypted`, encrypted again by the OS, to save instead of `encrypted`,
 *   or null, if there is nothing to change
 */
export async function passwordEncryptAgain(encrypted: string | null | undefined, password: string | null): Promise<string | null> {
  if (password == null || encrypted.startsWith(kOSPrefix)) {
    return null;
  }
  return await passwordEncryptWithOS(encrypted);
}

/** @param encrypted by `encrypt(secret, …)`, so that the password doesn't go to the backend and the OS in clear */
async function passwordEncryptWithOS(encrypted: string): Promise<string | null> {
  let encryptedByOS = await appGlobal.remoteApp.encryptWithOS?.(encrypted); // not on mobile and webmail
  return encryptedByOS ? kOSPrefix + encryptedByOS : null;
}
