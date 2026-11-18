import { WireMedia, WireAssetState } from "../../../../logic/Chat/Wire/WireMedia";
import { WireAPI } from "../../../../logic/Chat/Wire/WireAPI";
import { AssetRemoteData } from "../../../../logic/Chat/Wire/Proto/messages";
import type { Asset } from "../../../../logic/Chat/Wire/Proto/messages";
import type { TWireUser } from "../../../../logic/Chat/Wire/TWire";
import { decode, encode } from "../../../../logic/Chat/Signal/Proto/codec";
import { Attachment, type MessageWithAttachments } from "../../../../logic/Abstract/Attachment";
import { aesCBCDecrypt, bytesEqual, randomBytes, sha256 } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

/** A `WireTransport` stand-in: no network, and it keeps what we posted, so that
 * the tests can check the bytes on the wire. It also plays asset store: an
 * upload remembers the blob under its key, and a download hands it back. */
class FakeTransport {
  baseURL = "https://nginz-https.example.com";
  version = 5;
  /** The `multipart/mixed` body of the last upload, and its content type */
  body: Uint8Array;
  contentType: string;
  uploads = 0;
  /** What `POST /assets` answers */
  response: any = { key: "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac", domain: "example.com" };
  /** asset key -> the blob it holds */
  blobs = new Map<string, Uint8Array>();
  downloads: { path: string, query: any }[] = [];

  async postBinary(path: string, body: Uint8Array, contentType: string): Promise<any> {
    expect(path).toBe("/assets");
    this.body = body;
    this.contentType = contentType;
    this.uploads++;
    this.blobs.set(this.response.key, assetBytes(body, contentType));
    return this.response;
  }

  async getBinary(path: string, options?: any): Promise<Uint8Array> {
    this.downloads.push({ path, query: options?.query });
    return this.blobs.get(path.split("/").pop());
  }
}

/** A `ChatMessage` stand-in: `WireMedia` needs only its attachment side. */
class FakeMessage implements MessageWithAttachments {
  dbID = 1;
  attachments = new ArrayColl<Attachment>();
  newAttachment(): Attachment {
    let attachment = new Attachment();
    attachment.message = this;
    attachment.storage = new ArrayColl();
    return attachment;
  }
}

function newMedia(): { media: WireMedia, api: WireAPI, transport: FakeTransport } {
  let transport = new FakeTransport();
  let api = new WireAPI(transport as any);
  return { media: new WireMedia(api, "example.com"), api, transport };
}

/** The raw asset bytes out of a `multipart/mixed` body. `latin1` maps 1 byte to
 * 1 char, so the string offsets are byte offsets. */
function assetBytes(body: Uint8Array, contentType: string): Uint8Array {
  let text = new TextDecoder("latin1").decode(body);
  let boundary = contentType.split("boundary=")[1];
  let start = text.indexOf("\r\n\r\n", text.indexOf("Content-MD5:")) + 4;
  return body.subarray(start, text.lastIndexOf(`\r\n--${boundary}--\r\n`));
}

test("encrypt lays the blob out as iv ‖ ciphertext, digested over the ciphertext", async () => {
  let { media } = newMedia();
  let plaintext = randomBytes(1000);
  let { blob, remote } = await media.encrypt(plaintext);

  expect(remote.otrKey.length).toBe(32);
  expect(remote.sha256.length).toBe(32);
  // PKCS#7 always pads, so 1000 bytes become 1008, after the 16 byte IV
  expect(blob.length).toBe(16 + 1008);
  expect(bytesEqual(sha256(blob), remote.sha256)).toBe(true); // over the ciphertext
  expect(bytesEqual(sha256(plaintext), remote.sha256)).toBe(false); // not over the plaintext

  // The first 16 bytes are the IV, and the rest decrypts with it
  let decrypted = await aesCBCDecrypt(remote.otrKey, blob.subarray(0, 16), blob.subarray(16));
  expect(bytesEqual(decrypted, plaintext)).toBe(true);
});

test("a plaintext whose length is a multiple of the block size still grows", async () => {
  let { media } = newMedia();
  let { blob } = await media.encrypt(randomBytes(32));
  expect(blob.length).toBe(16 + 48); // a whole block of PKCS#7 padding
});

test("encrypt and decrypt round-trip", async () => {
  let { media } = newMedia();
  let plaintext = new TextEncoder().encode("Hello Wire, hier ist eine Datei.");
  let { blob, remote } = await media.encrypt(plaintext);
  expect(bytesEqual(await media.decrypt(blob, remote), plaintext)).toBe(true);
});

test("decrypt refuses a tampered blob, a wrong digest, and no digest at all", async () => {
  let { media } = newMedia();
  let { blob, remote } = await media.encrypt(randomBytes(100));

  await expect(media.decrypt(blob, { ...remote, sha256: randomBytes(32) })).rejects.toThrow();
  await expect(media.decrypt(blob, { ...remote, sha256: undefined })).rejects.toThrow();
  await expect(media.decrypt(blob, { ...remote, sha256: new Uint8Array(0) })).rejects.toThrow();

  let tampered = new Uint8Array(blob);
  tampered[20] ^= 0x40;
  await expect(media.decrypt(tampered, remote)).rejects.toThrow();
  // A flipped IV byte breaks the digest too, i.e. we never even start decrypting
  let tamperedIV = new Uint8Array(blob);
  tamperedIV[0] ^= 0x01;
  await expect(media.decrypt(tamperedIV, remote)).rejects.toThrow();
});

test("decrypt rejects an encryption algorithm that we did not implement", async () => {
  let { media } = newMedia();
  let { blob, remote } = await media.encrypt(randomBytes(10));
  await expect(media.decrypt(blob, { ...remote, encryption: 1 })).rejects.toThrow(); // AES_GCM
});

test("the multipart body is byte-exact", async () => {
  let { api, transport } = newMedia();
  await api.uploadAsset(new TextEncoder().encode("test"), { public: true, retention: "eternal" });

  let boundary = transport.contentType.split("boundary=")[1];
  expect(transport.contentType).toBe(`multipart/mixed; boundary=${boundary}`);
  expect(boundary).toMatch(/^Frontier[A-Za-z0-9]{32}$/);
  // The very request that the asset store froze as its own regression test,
  // `Protocol/10-Assets.md` §1.2, MD5 and all
  expect(new TextDecoder().decode(transport.body)).toBe(
    `--${boundary}\r\n` +
    "Content-Type: application/json;charset=utf-8\r\n" +
    "Content-length: 37\r\n" +
    "\r\n" +
    '{"public":true,"retention":"eternal"}\r\n' +
    `--${boundary}\r\n` +
    "Content-Type: application/octet-stream\r\n" +
    "Content-length: 4\r\n" +
    "Content-MD5: CY9rzUYh03PK3k6DJie09g==\r\n" +
    "\r\n" +
    "test\r\n" +
    `--${boundary}--\r\n`);
});

test("the JSON part is measured in UTF-8 bytes, not JS string length", async () => {
  let { api, transport } = newMedia();
  let filename = "Grüße-😀.pdf";
  await api.uploadAsset(new TextEncoder().encode("test"), {
    public: false,
    retention: "expiring",
    audit: { convID: { id: "c1", domain: "example.com" }, filename, filetype: "application/pdf" },
  });

  let json = '{"public":false,"retention":"expiring","convId":{"id":"c1","domain":"example.com"},' +
    `"filename":"${filename}","filetype":"application/pdf"}`;
  let byteLength = new TextEncoder().encode(json).length;
  expect(byteLength).toBeGreaterThan(json.length); // ü, ß and the emoji
  let boundary = transport.contentType.split("boundary=")[1];
  expect(new TextDecoder().decode(transport.body)).toBe(
    `--${boundary}\r\n` +
    "Content-Type: application/json;charset=utf-8\r\n" +
    `Content-length: ${byteLength}\r\n` +
    "\r\n" +
    json + "\r\n" +
    `--${boundary}\r\n` +
    "Content-Type: application/octet-stream\r\n" +
    "Content-length: 4\r\n" +
    "Content-MD5: CY9rzUYh03PK3k6DJie09g==\r\n" +
    "\r\n" +
    "test\r\n" +
    `--${boundary}--\r\n`);
});

test("the upload response maps onto RemoteData", async () => {
  let { media, transport } = newMedia();
  let plaintext = new TextEncoder().encode("an attachment");
  let remote = await media.upload(plaintext, "eternal-infrequent_access");

  expect(remote.assetID).toBe("3-1-47de4580-ae51-4650-acbb-d10c028cb0ac");
  expect(remote.assetDomain).toBe("example.com");
  expect(remote.assetToken).toBe(undefined); // public asset: the server minted none
  expect(remote.otrKey.length).toBe(32);
  // The digest is of what we uploaded, so the receiver can check it without the key
  expect(bytesEqual(remote.sha256, sha256(assetBytes(transport.body, transport.contentType)))).toBe(true);
  expect(new TextDecoder().decode(transport.body)).toContain('"retention":"eternal-infrequent_access"');
  // A public asset must not emit `asset_token`, field 5
  expect(decode(AssetRemoteData, encode(AssetRemoteData, remote)).assetToken).toBe(undefined);

  expect(bytesEqual(await media.download(remote), plaintext)).toBe(true);
  expect(transport.downloads).toEqual([
    { path: "/assets/example.com/3-1-47de4580-ae51-4650-acbb-d10c028cb0ac", query: {} }, // no token
  ]);
});

test("a token is sent only when the message carried one", async () => {
  let { media, transport } = newMedia();
  transport.response = { key: "3-3-47de4580-ae51-4650-acbb-d10c028cb0ac", domain: "example.com", token: "aGVsbG8" };
  let remote = await media.upload(new TextEncoder().encode("secret"), "volatile");

  expect(remote.assetToken).toBe("aGVsbG8");
  expect(decode(AssetRemoteData, encode(AssetRemoteData, remote)).assetToken).toBe("aGVsbG8");
  await media.download(remote);
  expect(transport.downloads[0].query).toEqual({ asset_token: "aGVsbG8" });
});

test("an asset without a domain falls back to our own backend", async () => {
  let { media, transport } = newMedia();
  let remote = await media.upload(new TextEncoder().encode("hi"));
  await media.download({ ...remote, assetDomain: undefined });
  expect(transport.downloads[0].path).toBe("/assets/example.com/3-1-47de4580-ae51-4650-acbb-d10c028cb0ac");
});

test("the 3 incoming asset messages update one attachment in place", async () => {
  let { media, transport } = newMedia();
  let plaintext = new TextEncoder().encode("Rechnung");
  let remote = await media.upload(plaintext, "expiring");
  let message = new FakeMessage();

  // 1. metadata only, while the sender is still uploading
  let metadata: Asset = { original: { mimeType: "application/pdf", name: "Rechnung.pdf", size: plaintext.length } };
  expect(media.applyAsset(message, metadata)).toBe(WireAssetState.Uploading);
  expect(message.attachments.length).toBe(1);
  let attachment = message.attachments.first;
  expect(attachment.filename).toBe("Rechnung.pdf");
  expect(attachment.mimeType).toBe("application/pdf");
  expect(attachment.size).toBe(plaintext.length);
  expect(attachment.content).toBe(undefined);

  // 2. the upload result, same message ID, and this sender repeats no metadata
  expect(media.applyAsset(message, { uploaded: remote })).toBe(WireAssetState.Uploaded);
  expect(message.attachments.length).toBe(1);
  expect(message.attachments.first).toBe(attachment);
  expect(attachment.filename).toBe("Rechnung.pdf"); // kept from message 1

  // The bytes arrive only when somebody asks for them
  expect(transport.downloads.length).toBe(0);
  await attachment.read();
  expect(bytesEqual(new Uint8Array(await attachment.content.arrayBuffer()), plaintext)).toBe(true);
  expect(attachment.size).toBe(plaintext.length);
});

test("a cancelled or failed upload is reported, and an image gets a filename", () => {
  let { media } = newMedia();
  let image: Asset = { original: { mimeType: "image/jpeg", size: 5 } };

  let cancelled = new FakeMessage();
  media.applyAsset(cancelled, image);
  expect(cancelled.attachments.first.filename).toBe("attachment.jpeg");
  expect(media.applyAsset(cancelled, { notUploaded: 0 })).toBe(WireAssetState.Cancelled);

  let failed = new FakeMessage();
  expect(media.applyAsset(failed, { ...image, notUploaded: 1 })).toBe(WireAssetState.Failed);
});

test("the download pointer survives a save to JSON and back", async () => {
  let { media } = newMedia();
  let remote = await media.upload(new TextEncoder().encode("hi"));
  let restored = WireMedia.remoteFromJSON(JSON.parse(JSON.stringify(WireMedia.remoteToJSON(remote))));

  expect(bytesEqual(restored.otrKey, remote.otrKey)).toBe(true);
  expect(bytesEqual(restored.sha256, remote.sha256)).toBe(true);
  expect(restored.assetID).toBe(remote.assetID);
  expect(restored.assetDomain).toBe(remote.assetDomain);
  expect(WireMedia.remoteFromJSON(null)).toBe(null);
});

test("the profile picture URL picks the right size and domain", () => {
  let { media } = newMedia();
  let user = {
    qualified_id: { id: "u1", domain: "example.com" },
    assets: [
      { key: "3-1-preview", domain: null, size: "preview", type: "image" },
      { key: "3-1-complete", domain: "other.example.org", size: "complete", type: "image" },
    ],
  } as any as TWireUser;

  // `preview` is the small avatar and `complete` the full-size picture
  expect(media.profilePictureURL(user)).toBe("https://nginz-https.example.com/v5/assets/example.com/3-1-preview");
  expect(media.profilePictureURL(user, "complete"))
    .toBe("https://nginz-https.example.com/v5/assets/other.example.org/3-1-complete");
  expect(media.profilePictureURL({ qualified_id: { id: "u2", domain: "example.com" }, assets: [] } as any)).toBe(null);
});

test("profile pictures are uploaded public, eternal, and unencrypted", async () => {
  let { media, transport } = newMedia();
  transport.response = { key: "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac", domain: "example.com" };
  let picture = new File([new Uint8Array([1, 2, 3, 4])], "me.jpg", { type: "image/jpeg" });
  let assets = await media.uploadProfilePicture(picture);

  expect(transport.uploads).toBe(2);
  expect(new TextDecoder().decode(transport.body)).toContain('{"public":true,"retention":"eternal"}');
  // No canvas in the test environment, so the picture goes up unscaled - but it
  // must go up unencrypted, or nobody could show the avatar.
  expect(bytesEqual(assetBytes(transport.body, transport.contentType), new Uint8Array([1, 2, 3, 4]))).toBe(true);
  expect(assets.map(asset => asset.size)).toEqual(["preview", "complete"]);
  expect(assets.every(asset => asset.type == "image" && asset.domain == "example.com")).toBe(true);
});
