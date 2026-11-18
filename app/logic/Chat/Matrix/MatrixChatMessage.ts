import { ChatMessage } from "../ChatMessage";
import { type Attachment, ContentDisposition } from "../../Abstract/Attachment";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import type { MatrixRoom } from "./MatrixRoom";
import { base64Decode, bytesEqual, sha256 } from "../Signal/Crypto/primitives";
import { appGlobal } from "../../app";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { MatrixClient } from "matrix-js-sdk";

const kMediaMsgTypes = ["m.image", "m.video", "m.audio", "m.file"];

export class MatrixChatMessage extends ChatMessage {
  declare to: MatrixRoom;

  constructor(chatRoom: MatrixRoom) {
    super(chatRoom);
  }
  get chatRoom(): MatrixRoom {
    return this.to;
  }

  override get canEdit(): boolean {
    return this.outgoing;
  }
  override get canDeleteForOthers(): boolean {
    return this.outgoing || this.to.isAdmin;
  }
  override canReact = true;

  /** Redact this message for everyone (`m.room.redaction`). */
  protected override async sendRetractionToOthers(): Promise<void> {
    await this.chatRoom.account.client.redactEvent(this.chatRoom.id, this.id);
  }

  /** Add or remove our own emoji reaction to this message (`m.reaction`). */
  override async setMyReaction(emoji: string | null): Promise<void> {
    let account = this.to.account;
    let room = this.to;
    let me = account.getPersonUID(account.globalUserID);
    if (emoji) {
      await account.client.sendEvent(room.id, "m.reaction" as any, {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: this.id,
          key: emoji,
        },
      } as any);
      this.reactions.set(me, emoji);
    } else {
      let previous = this.reactions.get(me);
      let reactionEventID = previous ? this.findOwnReactionEvent(this.id, previous) : null;
      if (reactionEventID) {
        await account.client.redactEvent(room.id, reactionEventID);
      }
      this.reactions.delete(me);
    }
    await this.save();
  }

  /** The id of our own `m.reaction` annotation with `key` on `targetID`, so we can
   * redact it to remove our reaction.
   * null, if it's not in the loaded timeline. */
  protected findOwnReactionEvent(targetID: string, key: string): string | null {
    let account = this.to.account;
    let room = this.to;
    let relations = account.client.getRoom(room.id)?.getUnfilteredTimelineSet()
      ?.relations?.getChildEventsForEvent(targetID, "m.annotation", "m.reaction");
    for (let event of relations?.getRelations() ?? []) {
      if (event.getSender() == account.globalUserID && (event.getRelation() as any)?.key == key) {
        return event.getId() ?? null;
      }
    }
    return null;
  }

  /** Sends an edit of an already-sent message (MSC2676)
   *
   * Sends new event that relates to the original via `m.replace`,
   * carrying the new content in `m.new_content`,
   * and a `* `-prefixed fallback `body` for clients that don't understand edits.
   *
   * Updates the original in place (see {@link getUserMessage}, the receive side). */
  async sendEdit(): Promise<void> {
    assert(this.isEdit, "Not an edited messsage");
    let account = this.to.account;
    let room = this.to;
    let original = room.messages.find(m => m.id == this.isEdit);
    assert(original instanceof MatrixChatMessage, gt`Cannot find the message to edit`);
    let newContent: any = {
      msgtype: "m.text",
      body: this.text,
    };
    let content: any = {
      msgtype: "m.text",
      body: "* " + this.text,
      "m.new_content": newContent,
      "m.relates_to": {
        rel_type: "m.replace",
        event_id: this.isEdit,
      },
    };
    if (this.hasHTML) {
      newContent.format = content.format = "org.matrix.custom.html";
      newContent.formatted_body = this.html;
      content.formatted_body = "* " + this.html;
    }
    await account.client.sendMessage(room.id, content);
    original.text = this.text;
    if (this.hasHTML) {
      original.rawHTMLDangerous = this.rawHTMLDangerous;
    }
    await original.save();
  }

  /** Whether an `m.room.message` content is a media (file) message. */
  static isMedia(content: any): boolean {
    return kMediaMsgTypes.includes(content?.msgtype);
  }

  /** Turns an `m.image`/`m.video`/`m.audio`/`m.file` msg content into an attachment and
   * downloads and decrypts the content in the background, and stores them.
   * Compare `WhatsAppMessage.addMedia()` and `XMPPChatMessage.addMediaFromURL()` */
  async addMedia(content: any): Promise<void> {
    let isImage = content.msgtype == "m.image";
    let attachment = this.newAttachment();
    attachment.filename = sanitize.filename(content.body, "file");
    attachment.mimeType = sanitize.string(content.info?.mimetype, "application/octet-stream");
    attachment.size = sanitize.integer(content.info?.size, null);
    attachment.disposition = isImage ? ContentDisposition.inline : ContentDisposition.attachment;
    this.attachments.add(attachment);
    await this.downloadAttachment(attachment, content);
  }

  /** Downloads and decrypts an attachment's bytes, fills them in, and persists them
   * to disk via the storage provider. Errors are the caller's to log. */
  protected async downloadAttachment(attachment: Attachment, content: any): Promise<void> {
    let bytes = await MatrixChatMessage.downloadMedia(content, this.chatRoom.account.client);
    attachment.content = new File([bytes as BufferSource], attachment.filename, { type: attachment.mimeType });
    attachment.size = bytes.length;
    await attachment.save();
  }

  /** Fetches an attachment's bytes from the Matrix media repo, decrypting them when
   * the message carries an `EncryptedFile` (`content.file`, i.e. an encrypted room). */
  protected static async downloadMedia(content: any, client: MatrixClient): Promise<Uint8Array> {
    let encrypted = content.file; // EncryptedFile, present in encrypted rooms
    let mxcURL = encrypted?.url ?? content.url;
    assert(mxcURL, "Matrix media message has no URL");
    let httpURL = client.mxcUrlToHttp(mxcURL, undefined, undefined, undefined, false, true, true);
    assert(httpURL, "Cannot resolve Matrix media URL " + mxcURL);
    let ky = await appGlobal.remoteApp.kyCreate({
      headers: {
        Authorization: `Bearer ${client.getAccessToken()}`,
      },
    });
    let bytes = new Uint8Array(await ky.get(httpURL, { result: "arrayBuffer" }));
    return encrypted ? await MatrixChatMessage.decryptFile(encrypted, bytes) : bytes;
  }

  /** Decrypts a Matrix encrypted attachment: AES-CTR-256 keyed by the JWK in the
   * message's `EncryptedFile`, with the IV as the initial counter block.
   * @throws if the file was changed */
  protected static async decryptFile(file: any, cipherBlob: Uint8Array): Promise<Uint8Array> {
    assert(file.key?.k && file.iv, "Matrix encrypted file is missing its key or IV");
    assert(file.v == "v2" && file.key.alg == "A256CTR", "Matrix encrypted file has an unknown version or algorithm");
    // AES-CTR doesn't detect changes, but the hash is in the end-to-end encrypted event, which the media server can't change
    assert(file.hashes?.sha256 && bytesEqual(sha256(cipherBlob), matrixBase64(file.hashes.sha256)),
      "Matrix encrypted file was changed: Its SHA-256 doesn't match");
    let keyBytes = matrixBase64(file.key.k);
    let counter = matrixBase64(file.iv);
    let key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "AES-CTR" }, false, ["decrypt"]);
    let plaintext = await crypto.subtle.decrypt({ name: "AES-CTR", counter: counter as BufferSource, length: 64 }, key, cipherBlob as BufferSource);
    return new Uint8Array(plaintext);
  }
}

/** Matrix encodes attachment keys/IVs as URL-safe, often unpadded base64. */
function matrixBase64(b64: string): Uint8Array {
  b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) {
    b64 += "=";
  }
  return base64Decode(b64);
}
