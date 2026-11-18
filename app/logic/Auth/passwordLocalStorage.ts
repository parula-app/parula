import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { passwordEncrypt, passwordDecrypt, passwordEncryptAgain } from "./passwordEncrypt";

export async function getPassword(account: string): Promise<string | null> {
  let encrypted = sanitize.string(localStorage.getItem(getKey(account)), null);
  let password = await passwordDecrypt(encrypted);
  // Older versions only obfuscated the password
  let encryptedAgain = await passwordEncryptAgain(encrypted, password);
  if (encryptedAgain) {
    localStorage.setItem(getKey(account), encryptedAgain);
  }
  return password;
}

export async function setPassword(account: string, password: string | null): Promise<void> {
  if (!password) {
    await deletePassword(account);
    return;
  }
  let encrypted = await passwordEncrypt(password);
  localStorage.setItem(getKey(account), encrypted);
}

export async function deletePassword(account: string): Promise<void> {
  localStorage.removeItem(getKey(account));
}

function getKey(account: string): string {
  return "password." + account;
}

if (!("localStorage" in globalThis)) {
  console.log("There is no localStorage. This is normal in tests.");
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => null,
    removeItem: () => null,
    key: () => null,
    clear: () => null,
    length: 0,
  };
}
