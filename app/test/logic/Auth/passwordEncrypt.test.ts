// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Account } from "../../../logic/Abstract/Account";
import { Person } from "../../../logic/Abstract/Person";
import { passwordDecrypt, passwordEncrypt } from "../../../logic/Auth/passwordEncrypt";
import { getPassword } from "../../../logic/Auth/passwordLocalStorage";
import { AccountType, SQLAccount } from "../../../logic/Mail/SQL/Account/SQLAccount";
import { getDatabase } from "../../../logic/Mail/SQL/Account/SQLDatabase";
import { InProcessSQLiteDatabase } from "../util/inProcessSQLite";
import sql from "../../../../lib/rs-sqlite";
import { decrypt, encrypt } from "password-salt";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

const kPassword = "my-secret-password";
const kOldSecret = "anything"; // which older versions used for all passwords

/** Stands in for Electron `safeStorage` in the backend: only it can decrypt */
class FakeOSKeyStore {
  stored = new Map<string, string>();

  encryptWithOS(plainText: string): string {
    let encrypted = crypto.randomUUID();
    this.stored.set(encrypted, plainText);
    return encrypted;
  }
  decryptWithOS(encrypted: string): string {
    if (!this.stored.has(encrypted)) {
      throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString");
    }
    return this.stored.get(encrypted);
  }
}

class TestAccount extends Account {
  readonly protocol: string = "test";
}

beforeAll(() => {
  appGlobal.me = new Person(); // as `startup.ts` does
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("Passwords: When the OS has a key store, nobody can decrypt the saved password without it", async () => {
  appGlobal.remoteApp = new FakeOSKeyStore();
  let saved = await passwordEncrypt(kPassword);
  expect(saved).not.toContain(kPassword);
  await expect(decrypt(kOldSecret, saved)).rejects.toThrow();
  expect(await passwordDecrypt(saved)).toBe(kPassword);

  appGlobal.remoteApp = new FakeOSKeyStore(); // e.g. the profile moved to another computer
  expect(await passwordDecrypt(saved)).toBeNull();
});

test.each([
  ["Linux without a keyring", { encryptWithOS: () => null }],
  ["mobile", {}],
])("Passwords: Without an OS key store, e.g. on %s, the passwords still work", async (_platform, remoteApp) => {
  appGlobal.remoteApp = remoteApp;
  let saved = await passwordEncrypt(kPassword);
  expect(saved).not.toContain(kPassword);
  expect(await passwordDecrypt(saved)).toBe(kPassword);
});

test("Accounts: A password from an older version still works, and is then encrypted by the OS", async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "password-encrypt-test-"));
  appGlobal.remoteApp = Object.assign(new FakeOSKeyStore(), {
    getSQLiteDatabase: (filename: string) => new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  });
  await SQLAccount.save(new TestAccount(), AccountType.Mail);
  // as older versions saved it
  await (await getDatabase()).run(sql`UPDATE account SET json = json_set(json, '$.passwordEncrypted', ${await encrypt(kOldSecret, kPassword)})`);

  let [row] = await SQLAccount.readAll(AccountType.Mail);
  let read = await SQLAccount.read(row, new TestAccount());
  expect(read.password).toBe(kPassword);

  [row] = await SQLAccount.readAll(AccountType.Mail);
  let saved = JSON.parse(row.json).passwordEncrypted;
  await expect(decrypt(kOldSecret, saved)).rejects.toThrow();
  expect(await passwordDecrypt(saved)).toBe(kPassword);
});

test("OAuth2: A refresh token from an older version still works, and is then encrypted by the OS", async () => {
  appGlobal.remoteApp = new FakeOSKeyStore();
  let localStorage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => localStorage.get(key) ?? null,
    setItem: (key: string, value: string) => localStorage.set(key, value),
  });
  localStorage.set("password.oauth2-test", await encrypt(kOldSecret, kPassword));

  expect(await getPassword("oauth2-test")).toBe(kPassword);

  let saved = localStorage.get("password.oauth2-test");
  await expect(decrypt(kOldSecret, saved)).rejects.toThrow();
  expect(await getPassword("oauth2-test")).toBe(kPassword);
});
