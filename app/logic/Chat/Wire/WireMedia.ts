/** Wire's asset layer: message attachments (files, images, audio, video) and
 * profile pictures.
 *
 * Wire's asset store never sees plaintext. We encrypt the file with a fresh
 * AES-256 key, upload `iv ‖ ciphertext` as an opaque blob, and put the key and
 * the SHA-256 *of that blob* into the end-to-end encrypted message. There is no
 * MAC: the digest is the only integrity check, which is why it must be verified
 * before we decrypt. Profile pictures are the deliberate exception - they are
 * public and unencrypted.
 *
 * See `Protocol/10-Assets.md`. */
import { ContentDisposition, type Attachment, type AttachmentStorage, type MessageWithAttachments } from "../../Abstract/Attachment";
import type { WireAPI } from "./WireAPI";
import type { TWireAsset, TWireAssetAudit, TWireAssetRetention, TWireAssetUploadOptions, TWireUser, TWireUserAsset } from "./TWire";
import { assetStatusKind, AssetNotUploaded, EncryptionAlgorithm, type Asset, type AssetOriginal, type AssetRemoteData } from "./Proto/messages";
import { aesCBCDecrypt, aesCBCEncrypt, base64Decode, base64Encode, bytesEqual, concatBytes, randomBytes, sha256 } from "../Signal/Crypto/primitives";
import { retryOnTransientError } from "../../util/netUtil";
import { assert, fileExtensionForMIMEType } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ArrayColl } from "svelte-collections";

export class WireMedia {
  /** @param ourDomain our backend's domain. Used when a peer that predates
   *   federation sent no `asset_domain` with its asset. */
  constructor(readonly api: WireAPI, readonly ourDomain: string) {
  }

  /** Encrypts and uploads `attachment`, and returns the `Asset` for the outgoing
   * `GenericMessage`. Wire's 3-message pattern (metadata, then the upload result,
   * then possibly an abort) is a sender's choice; we send only the final form,
   * i.e. `original` and `uploaded` together in one message. */
  async uploadAttachment(attachment: Attachment, retention: TWireAssetRetention = "expiring"): Promise<Asset> {
    await attachment.load();
    assert(attachment.content, `Wire: attachment ${attachment.filename} has no content to send`);
    let plaintext = new Uint8Array(await attachment.content.arrayBuffer());
    let original = await this.originalFor(attachment, plaintext.length);
    let uploaded = await this.upload(plaintext, retention);
    return { original, uploaded };
  }

  /** Encrypts `plaintext`, uploads the ciphertext, and returns everything the
   * receiver needs to fetch and open it again. */
  async upload(plaintext: Uint8Array, retention: TWireAssetRetention = "expiring", audit?: TWireAssetAudit): Promise<AssetRemoteData> {
    let { blob, remote } = await this.encrypt(plaintext);
    // Attachments are uploaded publicly: their secret is the AES key, not a token.
    let asset = await this.uploadBlob(blob, { public: true, retention, audit });
    return {
      ...remote,
      assetID: asset.key,
      assetToken: asset.token ?? undefined,
      assetDomain: asset.domain,
    };
  }

  /** AES-256-CBC with PKCS#7, a fresh key and IV each time. The blob to upload is
   * `iv ‖ ciphertext` and the digest covers all of it, so a receiver can check it
   * without knowing the key. */
  async encrypt(plaintext: Uint8Array): Promise<{ blob: Uint8Array, remote: AssetRemoteData }> {
    let otrKey = randomBytes(32);
    let iv = randomBytes(16);
    let blob = concatBytes(iv, await aesCBCEncrypt(otrKey, iv, plaintext));
    return { blob, remote: { otrKey, sha256: sha256(blob) } };
  }

  protected async uploadBlob(blob: Uint8Array, options: TWireAssetUploadOptions): Promise<TWireAsset> {
    return await retryOnTransientError(() => this.api.uploadAsset(blob, options));
  }

  /** Applies an incoming `Asset` to `message`, creating or updating its
   * attachment. A sender may send up to 3 of these under the same message ID:
   * the metadata while the upload is still running, then the upload result, or
   * an abort. Only the first one carries `original`, so keep what we learned.
   * @returns how far the sender got, for the UI to show. */
  applyAsset(message: MessageWithAttachments, asset: Asset): WireAssetState {
    let attachment = message.attachments.first;
    if (!attachment) {
      attachment = message.newAttachment();
      message.attachments.add(attachment);
    }
    if (asset.original) {
      this.applyOriginal(attachment, asset.original);
    }
    switch (assetStatusKind(asset)) {
      case "uploaded":
        this.makeDownloadable(attachment, asset.uploaded);
        return WireAssetState.Uploaded;
      case "notUploaded":
        // `CANCELLED` is the proto2 default, so a bare `not_uploaded` means it.
        return asset.notUploaded == AssetNotUploaded.Failed
          ? WireAssetState.Failed
          : WireAssetState.Cancelled;
      default:
        return WireAssetState.Uploading;
    }
  }

  protected applyOriginal(attachment: Attachment, original: AssetOriginal): void {
    attachment.mimeType = sanitize.nonemptystring(original.mimeType, "application/octet-stream");
    let filename = original.name && sanitize.filename(original.name, null);
    attachment.filename = filename || this.defaultFilename(attachment.mimeType);
    attachment.size = sanitize.integer(original.size, null);
    attachment.disposition = ContentDisposition.attachment;
  }

  /** Images are sent without a name of their own. */
  protected defaultFilename(mimeType: string): string {
    let ext = fileExtensionForMIMEType(mimeType);
    return "attachment." + (ext.startsWith(".") ? ext.slice(1) : ext);
  }

  /** Lets `attachment.read()` fetch the file from Wire's asset store. Runs behind
   * the local file storage, so we download only what is not on disk yet. */
  makeDownloadable(attachment: Attachment, remote: AssetRemoteData): void {
    attachment.storage = new ArrayColl([...attachment.storage ?? [], new WireAssetDownload(this, remote)]);
  }

  /** Downloads the ciphertext, checks its digest, and decrypts it. */
  async download(remote: AssetRemoteData): Promise<Uint8Array> {
    let key = sanitize.alphanumdash(remote.assetID, null);
    assert(key, "Wire: message carries no asset ID");
    let domain = sanitize.hostname(remote.assetDomain || this.ourDomain, null);
    assert(domain, `Wire: bad asset domain ${remote.assetDomain}`);
    // Send a token only if the message carried one: the server compares ours
    // against the stored one, and a public asset has none, so sending one 404s.
    let token: string | null = null;
    if (remote.assetToken) {
      assert(/^[A-Za-z0-9+/=_-]+$/.test(remote.assetToken), "Wire: bad asset token");
      token = remote.assetToken;
    }
    let blob = await retryOnTransientError(() => this.api.downloadAsset(domain, key, token));
    return await this.decrypt(blob, remote);
  }

  /** Verifies the digest over the whole blob *before* decrypting, so tampered or
   * truncated bytes never reach the cipher and we never return partial data.
   * @throws if the digest is missing or does not match. */
  async decrypt(blob: Uint8Array, remote: AssetRemoteData): Promise<Uint8Array> {
    assert(remote.otrKey?.length == 32, "Wire: asset needs a 32 byte AES key");
    assert(remote.sha256?.length, "Wire: refusing to decrypt an asset without a digest");
    // Nothing emits AES_GCM, and no nonce/tag layout is specified for it anywhere.
    assert(!remote.encryption || remote.encryption == EncryptionAlgorithm.AESCBC,
      `Wire: unsupported asset encryption ${remote.encryption}`);
    assert(blob.length > 16, "Wire: asset is too short to hold an IV");
    if (!bytesEqual(sha256(blob), remote.sha256)) {
      throw new Error("Wire: asset does not match its SHA-256 digest");
    }
    return await aesCBCDecrypt(remote.otrKey, blob.subarray(0, 16), blob.subarray(16));
  }

  /** The download pointer for `WireChatMessage.toExtraJSON()`. Without it, a
   * restart could no longer fetch a file that we did not download yet. */
  static remoteToJSON(remote: AssetRemoteData): any {
    return {
      otrKey: base64Encode(remote.otrKey),
      sha256: base64Encode(remote.sha256),
      assetID: remote.assetID,
      assetToken: remote.assetToken,
      assetDomain: remote.assetDomain,
    };
  }

  static remoteFromJSON(json: any): AssetRemoteData | null {
    if (!json?.otrKey || !json.sha256) {
      return null;
    }
    return {
      otrKey: base64Decode(json.otrKey),
      sha256: base64Decode(json.sha256),
      assetID: json.assetID,
      assetToken: json.assetToken ?? undefined,
      assetDomain: json.assetDomain ?? undefined,
    };
  }

  /** Uploads our profile picture in the 2 sizes Wire publishes, and returns the
   * `assets` entries for `PUT /self`. These are public and unencrypted, on
   * purpose: everyone who may see us must be able to render the avatar.
   * `preview` is the small avatar and `complete` the full-size picture - the
   * reference web client fills these two the wrong way around. */
  async uploadProfilePicture(picture: File): Promise<TWireUserAsset[]> {
    let preview = await this.uploadPublic(await this.scaleImage(picture, 280));
    let complete = await this.uploadPublic(await this.scaleImage(picture, 1448));
    return [
      { key: preview.key, domain: preview.domain, size: "preview", type: "image" },
      { key: complete.key, domain: complete.domain, size: "complete", type: "image" },
    ];
  }

  protected async uploadPublic(bytes: Uint8Array): Promise<TWireAsset> {
    return await retryOnTransientError(() => this.api.uploadAsset(bytes, { public: true, retention: "eternal" }));
  }

  /** Where to fetch a user's avatar. Nothing to decrypt and no token to send:
   * the asset is public, and sending a token would even make the server refuse.
   * The entry's domain is optional, and then means the user's own backend. */
  profilePictureURL(user: TWireUser, size: "preview" | "complete" = "preview"): string | null {
    let asset = user.assets?.find(asset => asset.type == "image" && asset.size == size);
    if (!asset) {
      return null;
    }
    return this.api.assetURL(asset.domain ?? user.qualified_id.domain, asset.key);
  }

  /** The plaintext file's type, size and dimensions, so that the receiver can
   * show it correctly before downloading anything. */
  protected async originalFor(attachment: Attachment, size: number): Promise<AssetOriginal> {
    return {
      mimeType: attachment.mimeType || "application/octet-stream",
      size,
      name: attachment.filename,
      ...await this.metadataFor(attachment.content),
    };
  }

  /** Pixel size for images, duration for audio and video. Best effort: a file we
   * cannot decode simply goes without, which the protocol allows. */
  protected async metadataFor(file: File): Promise<Pick<AssetOriginal, "image" | "video" | "audio">> {
    try {
      if (file.type?.startsWith("image/")) {
        let bitmap = await createImageBitmap(file);
        let image = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return { image };
      } else if (file.type?.startsWith("video/")) {
        let video = await this.mediaMetadata(file, "video");
        return { video };
      } else if (file.type?.startsWith("audio/")) {
        let { durationInMillis } = await this.mediaMetadata(file, "audio");
        return { audio: { durationInMillis } };
      }
    } catch (ex) {
      console.log("Wire: Could not read the metadata of", file.name, ex);
    }
    return {};
  }

  /** Loads the file into a media element far enough to read its duration and,
   * for video, its pixel size. */
  protected mediaMetadata(file: File, kind: "video" | "audio"): Promise<{ durationInMillis: number, width?: number, height?: number }> {
    return new Promise((resolve, reject) => {
      let element = document.createElement(kind);
      let url = URL.createObjectURL(file);
      element.preload = "metadata";
      element.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        let video = element as HTMLVideoElement;
        resolve({
          durationInMillis: Math.round(element.duration * 1000),
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
        });
      };
      element.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Wire: Could not decode ${file.name}`));
      };
      element.src = url;
    });
  }

  /** Scales the picture to fit `maxSize` in both dimensions, as JPEG. Falls back
   * to the original bytes on a platform without an offscreen canvas. */
  protected async scaleImage(picture: File, maxSize: number): Promise<Uint8Array> {
    try {
      let bitmap = await createImageBitmap(picture);
      let scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      let canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      let scaled = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
      return new Uint8Array(await scaled.arrayBuffer());
    } catch (ex) {
      console.log("Wire: Could not scale the profile picture", ex);
      return new Uint8Array(await picture.arrayBuffer());
    }
  }
}

/** Fetches one attachment's bytes from Wire's asset store, on demand.
 * Sits in `Attachment.storage` behind the local file storage, so that
 * `attachment.read()` downloads only what we do not have on disk. */
class WireAssetDownload implements AttachmentStorage {
  supportsAttachments = true;

  constructor(protected readonly media: WireMedia, protected readonly remote: AssetRemoteData) {
  }

  async readAttachment(attachment: Attachment): Promise<boolean> {
    if (attachment.content) {
      return true;
    }
    let plaintext = await this.media.download(this.remote);
    attachment.content = new File([plaintext as unknown as BlobPart], attachment.filename, { type: attachment.mimeType });
    attachment.size = plaintext.length;
    return true;
  }

  /** The asset store holds only what its uploader put there, and an attachment
   * of ours is already uploaded by the time anybody sees it. */
  async saveAttachment(attachment: Attachment): Promise<void> {
  }

  async deleteAttachment(attachment: Attachment): Promise<void> {
  }
}

/** What the sender last told us about an attachment transfer. `Uploading` is the
 * metadata-only message that some clients send while the upload runs. */
export enum WireAssetState {
  Uploading = "uploading",
  Uploaded = "uploaded",
  Cancelled = "cancelled",
  Failed = "failed",
}
