// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { setupTestFolder } from "../../logic/Mail/SQL/setup";
import type { EMail } from "../../../logic/Mail/EMail";
import { openFileInternally } from "../../../frontend/Files/open";
import { openEMailMessage } from "../../../frontend/Mail/open";
import { kClearSigned, kClearSignedLatin1, kClearSignedUTF8, kOpaqueSigned } from "../../logic/Mail/Encryption/SMIME/signedMessages";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../frontend/Mail/open", () => ({ openEMailMessage: vi.fn() }));

// The browser has this, but Node does not.
globalThis.indexedDB ??= {
  cmp(a: Uint8Array, b: Uint8Array): number {
    let length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] != b[i]) {
        return a[i] < b[i] ? -1 : 1;
      }
    }
    return Math.sign(a.length - b.length);
  },
} as any;

afterEach(() => {
  appGlobal.emailAccounts.clear();
});

/** Opens the .eml file as the app does, and returns the mail that it shows */
async function openEMLFile(mime: Uint8Array): Promise<EMail> {
  let { folder } = await setupTestFolder();
  folder.account.rootFolders.add(folder);
  appGlobal.emailAccounts.add(folder.account);
  await openFileInternally(mime, "message/rfc822");
  return vi.mocked(openEMailMessage).mock.lastCall[0];
}

/** As a file with LF line endings. The mails were signed with CRLF, as they are sent. */
function withLF(mime: string): Uint8Array {
  return Uint8Array.from(mime, c => c.charCodeAt(0));
}

describe("S/MIME signed .eml file with LF line endings", () => {
  test("clear-signed", async () => {
    let email = await openEMLFile(withLF(kClearSigned));
    expect(email.text.trim()).toBe("Hello, this is signed.");
    expect(email.signedKey?.userIDs.contents).toContain("alice@example.com");
  });

  test("clear-signed, 8-bit text in UTF-8", async () => {
    let email = await openEMLFile(new TextEncoder().encode(kClearSignedUTF8));
    expect(email.text.trim()).toBe("Grüße aus Köln");
    expect(email.signedKey?.userIDs.contents).toContain("joerg@example.com");
  });

  /** Fails if the conversion goes through a UTF-8 string */
  test("clear-signed, 8-bit text in ISO-8859-1", async () => {
    let email = await openEMLFile(withLF(kClearSignedLatin1));
    expect(email.text.trim()).toBe("Grüße aus Köln");
    expect(email.signedKey?.userIDs.contents).toContain("heidi@example.com");
  });

  test("opaque-signed", async () => {
    let email = await openEMLFile(withLF(kOpaqueSigned));
    expect(email.text.trim()).toBe("Hello, this is signed.");
    expect(email.signedKey?.userIDs.contents).toContain("alice@example.com");
  });
});
