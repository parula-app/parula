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
  if (!encrypted.startsWith(kOSPrefix)) {
    return sanitize.string(await decrypt(secret, encrypted) as string, null);
  }
  try {
    return sanitize.string(await appGlobal.remoteApp.decryptWithOS(encrypted.substring(kOSPrefix.length)), null);
  } catch (ex) {
    // The OS lost our key, e.g. when the profile moved to another computer. The user needs to enter the password again.
    minorError(ex);
    return null;
  }
}

export async function passwordEncrypt(password: string | null | undefined): Promise<string | null> {
  if (password == null) {
    return null;
  }
  return await passwordEncryptWithOS(password) ?? await encrypt(secret, password);
}

/**
 * For passwords that are only obfuscated, because older versions saved them,
 * or because the OS key store was not available at that time.
 * @returns `password` encrypted by the OS, to save instead of `encrypted`,
 *   or null, if there is nothing to change
 */
export async function passwordEncryptAgain(encrypted: string | null | undefined, password: string | null): Promise<string | null> {
  if (password == null || encrypted.startsWith(kOSPrefix)) {
    return null;
  }
  return await passwordEncryptWithOS(password);
}

async function passwordEncryptWithOS(password: string): Promise<string | null> {
  let encrypted = await appGlobal.remoteApp.encryptWithOS?.(password); // not on mobile and webmail
  return encrypted ? kOSPrefix + encrypted : null;
}
