// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MatrixChatMessage } from "../../../../logic/Chat/Matrix/MatrixChatMessage";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { randomBytes, sha256 } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { expect, test } from "vitest";

/** Encrypts a file like the sending Matrix client does.
 * @returns the file message, and the ciphertext that the media server has */
async function encryptedFileMessage(plaintext: Uint8Array): Promise<{ content: any, ciphertext: Uint8Array }> {
  let keyBytes = randomBytes(32);
  let iv = new Uint8Array(16);
  iv.set(randomBytes(8)); // the lower 8 bytes are the counter
  let key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-CTR", false, ["encrypt"]);
  let ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, plaintext as BufferSource));
  let content = {
    msgtype: "m.file",
    body: "offer.txt",
    file: {
      v: "v2",
      url: "mxc://matrix.example/offer",
      key: { kty: "oct", alg: "A256CTR", ext: true, key_ops: ["encrypt", "decrypt"], k: Buffer.from(keyBytes).toString("base64url") },
      iv: Buffer.from(iv).toString("base64").replaceAll("=", ""),
      hashes: { sha256: Buffer.from(sha256(ciphertext)).toString("base64").replaceAll("=", "") },
    },
  };
  return { content, ciphertext };
}

/** Receives the file message, and the media server returns `served` */
async function receive(content: any, served: Uint8Array): Promise<MatrixChatMessage> {
  appGlobal.remoteApp = {
    kyCreate: async () => ({
      get: async () => served.slice().buffer,
    }),
  };
  let room = {
    account: {
      storage: new DummyChatStorage(),
      client: {
        mxcUrlToHttp: (mxcURL: string) => "https://matrix.example/_matrix/client/v1/media/download/" + mxcURL.substring(6),
        getAccessToken: () => "token",
      },
    },
  } as any;
  let msg = new MatrixChatMessage(room);
  await msg.addMedia(content);
  return msg;
}

test("An encrypted attachment is decrypted", async () => {
  let { content, ciphertext } = await encryptedFileMessage(new TextEncoder().encode("We offer 100 €"));
  let msg = await receive(content, ciphertext);
  expect(await msg.attachments.first.content.text()).toBe("We offer 100 €");
});

test("A changed encrypted attachment is rejected", async () => {
  let { content, ciphertext } = await encryptedFileMessage(new TextEncoder().encode("We offer 100 €"));
  // AES-CTR: Flipping a bit of the ciphertext flips the same bit of the plaintext
  let changed = ciphertext.slice();
  changed[9] ^= "1".charCodeAt(0) ^ "9".charCodeAt(0); // 100 € -> 900 €
  await expect(receive(content, changed)).rejects.toThrow();

  // Without hash
  delete content.file.hashes;
  await expect(receive(content, ciphertext)).rejects.toThrow();
});
