import { File as FileEntry } from "../Files/File";
import { checkExecutableFile, executableMessage, ExecutableKind } from "../Files/FileType/ExecutableFile";
import { EMail } from "../Mail/EMail";
import { appGlobal } from "../app";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { openOSAppForFile } from "../util/os-integration";
import { RunOnce } from "../util/flow/RunOnce";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { UserError, type URLString, fileExtensionForMIMEType, assert } from "../util/util";
import { blobToBase64 } from "../util/blob";
import { gt } from "../../l10n/l10n";
import type { ArrayColl, Collection } from "svelte-collections";

export class Attachment extends Observable {
  /** filename with extension, as given by the sender of the email */
  @notifyChangedProperty
  filename: string;
  /** Where the attachment is stored on the user's local disk, after download */
  @notifyChangedProperty
  filepathLocal: string;
  @notifyChangedProperty
  mimeType: string;
  /** File size, in bytes
   * null, if the attachment wasn't downloaded yet. */
  @notifyChangedProperty
  size: number | null;
  @notifyChangedProperty
  disposition = ContentDisposition.unknown;
  /** embedded image */
  @notifyChangedProperty
  related: boolean;
  @notifyChangedProperty
  contentID: string;
  /** Protocol-specific ID of this attachment on the server, e.g. the EWS `AttachmentId`.
   * null, if the attachment isn't on the server yet. */
  @notifyChangedProperty
  pID: string | null = null;
  /** File contents. Not populated, if we have the attachment saved on disk */
  @notifyChangedProperty
  content: File;
  /** Would opening this file run untrusted code?
   * Checked once, when we get the contents, and saved in the DB.
   * null = none. undefined = not checked. */
  @notifyChangedProperty
  executable: ExecutableKind | null | undefined;
  /** Override the default hidden state.
   * Currently not saved to DB. */
  @notifyChangedProperty
  protected _hidden: boolean | null = null;
  protected _blobURL: URLString;
  /** Exists while editing or displaying. */
  dataURL: URLString;
  /** The email, chat message or calendar event that this attachment is part of */
  message: MessageWithAttachments;
  storage: Collection<AttachmentStorage>;
  storageRunOnce = new RunOnce<void>();

  protected static urlFinalizer = new FinalizationRegistry((url: URLString) => {
    URL.revokeObjectURL(url);
  });

  /** Exists while attachment is alive in memory.
    * Don't `URL.revokeObjectURL()` manually because
    * it will make the URL invalid somewhere else
    * the FinalizationRegistry will take care of it.
    */
  get blobURL(): URLString {
    if (this._blobURL) {
      return this._blobURL;
    }
    if (!this.content) {
      return null;
    }
    this._blobURL = URL.createObjectURL(this.content);
    Attachment.urlFinalizer.register(this, this._blobURL, this);
    return this._blobURL;
  }

  fromFile(file: File) {
    this.content = file;
    this.filename = file.name;
    this.mimeType = file.type;
    this.size = file.size;
    this.disposition = ContentDisposition.attachment;
  }

  /** Creates a copy that belongs to the email, chat message or event `to`.
   * The copy isn't saved yet, so it must not point to the original's
   * file on disk nor to its attachment on the server. */
  cloneTo(to: MessageWithAttachments): Attachment {
    let clone = to.newAttachment();
    let { message, storage, storageRunOnce } = clone;
    Object.assign(clone, this, { message, storage, storageRunOnce, filepathLocal: null, pID: null, _blobURL: null });
    if (this.content) {
      clone.content = new File([this.content], this.filename, { type: this.mimeType });
    }
    return clone;
  }

  asFileEntry(): FileEntry {
    let file = new AttachmentFile();
    file.attachment = this;
    file.setFileName(this.filename);
    file.filepathLocal = this.filepathLocal;
    file.size = this.size;
    file.mimetype = this.mimeType;
    file.contents = this.content;
    file.executable = this.executable;
    file.id = this.contentID;
    return file;
  }

  get ext(): string {
    return this.filename.split(".").pop();
  }

  async load() {
    if (this.content) {
      return;
    }
    await this.message.loadAttachments?.();
  }

  async getContent(): Promise<File> {
    await this.load();
    return this.content;
  }

  async readLocalFile() {
    assert(this.filepathLocal, "Need local file first");
    let array = await appGlobal.remoteApp.readFile(this.filepathLocal);
    this.content = new File([array], this.filename, { type: this.mimeType });
  }

  /** The file contents, base64-encoded, to send it to the server */
  async contentAsBase64(): Promise<string> {
    try {
      return await blobToBase64(this.content);
    } catch (ex) {
      throw new UserError(gt`Could not read the attachment ${this.filename}. The file may have been moved, deleted or changed on disk.`);
    }
  }

  /** Open the native desktop app with this file */
  async openOSApp() {
    if (this.executable === undefined) { // e.g. saved before we had this check
      await this.read(); // we need the contents, to check them
      await this.checkExecutable();
    }
    if (this.executable) {
      throw new UserError(executableMessage(this.executable));
    }
    await openOSAppForFile(this.filepathLocal);
  }
  /** Determines whether this file is code.
   * Call this whenever we got the contents */
  async checkExecutable(): Promise<void> {
    if (!this.content && this.filepathLocal) {
      await this.readLocalFile();
    }
    this.executable = await checkExecutableFile(this.filename, this.mimeType, this.filepathLocal, this.content);
  }
  /** Open the native file manager with the folder
   * where this file is, and select this file. */
  async openOSFolder() {
    await appGlobal.remoteApp.showFileInFolder(this.filepathLocal);
  }
  async deleteFile() {
    await this.storageRunOnce.runOnce(async () => {
      for (let storage of this.storage) {
        await storage.deleteAttachment(this);
      }
    });
    this.filepathLocal = null;
    await this.save();
  }
  async read() {
    await this.storageRunOnce.runOnce(async () => {
      for (let storage of this.storage) {
        if (await storage.readAttachment(this)) {
          break;
        }
      }
    });
  }
  async save() {
    await this.storageRunOnce.runOnce(async () => {
      for (let storage of this.storage) {
        await storage.saveAttachment(this);
      }
    });
  }

  toJSON(): any {
    let json = this.toExtraJSON();
    json.filename = this.filename;
    json.mimeType = this.mimeType;
    json.size = this.size;
    json.contentID = this.contentID;
    json.disposition = this.disposition;
    json.related = this.related;
    return json;
  }

  fromJSON(json: any, fallbackID: number, filesDir: string) {
    this.mimeType = sanitize.nonemptystring(json.mimeType, "application/octet-stream");
    this.contentID = sanitize.nonemptystring(json.contentID, "" + fallbackID);
    this.filename = sanitize.nonemptystring(json.filename, "attachment-" + fallbackID + "." + fileExtensionForMIMEType(this.mimeType));
    let filepathLocal = sanitize.string(json.filepathLocal, null)
    if (filepathLocal && filesDir) {
      this.filepathLocal = filesDir + "/" + filepathLocal;
    }
    this.size = sanitize.integer(json.size, -1);
    this.disposition = sanitize.translate(json.disposition, {
      attachment: ContentDisposition.attachment,
      inline: ContentDisposition.inline,
    }, ContentDisposition.unknown);
    this.related = sanitize.boolean(json.related, false);
    this.fromExtraJSON(json);
  }

  /** The `json` column of the DB row, for properties that not every protocol
   * has, and that therefore have no column of their own */
  toExtraJSON(): any {
    let json: any = {};
    json.executable = this.executable;
    return json;
  }
  fromExtraJSON(json: any) {
    this.executable = json?.executable === undefined
      ? undefined
      : sanitize.enum(json.executable, Object.values(ExecutableKind), null);
  }

  /** Should not show to end user. This is true for auto-processing attachments
   * like calendar invitations (ICS), vCards, encryption signatures etc. */
  get hidden(): boolean {
    return this._hidden != null
      ? this._hidden
      : kHiddenMIMETypes.includes(this.mimeType);
  }
  set hidden(val: boolean) {
    this._hidden = val;
  }
}

/** A `File` view of an email `Attachment`, so the Files UI (contact history,
 * person files pane) can open and preview it. Fetching the bytes delegates to
 * the `Attachment`, which knows how to get them from disk or the email. */
export class AttachmentFile extends FileEntry {
  attachment: Attachment;

  async download() {
    if (this.contents) {
      return;
    }
    await this.downloadRunOnce.runOnce(async () => {
      if (this.contents) {
        return;
      }
      let attachment = this.attachment;
      let message = attachment.message;
      if (!attachment.filepathLocal && message instanceof EMail) {
        await message.loadMIME(); // downloads the email, if not already on disk
        // `parseMIME()` may have replaced the attachment objects
        attachment = message.attachments.find(a => a.contentID == attachment.contentID) ?? attachment;
        this.attachment = attachment;
      }
      await attachment.load(); // read `content` from disk (or MIME)
      if (attachment.content && !attachment.filepathLocal) {
        await attachment.save(); // write to disk, so `openOSApp()` has a file path
      }
      await attachment.checkExecutable();
      this.executable = attachment.executable;
      this.contents = attachment.content;
      this.filepathLocal = attachment.filepathLocal;
    });
  }
}

export enum ContentDisposition {
  unknown = "unknown",
  inline = "inline",
  attachment = "attachment",
}

const kHiddenMIMETypes = [
  "application/ld+json", // SML
  "application/ics", // calendar invitation
  "text/vcard", // vCard
  "text/calendar", // vCard
  "application/pkcs7-signature", // S/MIME signature
  "application/x-pkcs7-signature", // S/MIME signature, legacy type name
  "application/pgp-signature", // PGP signature
  "application/pgp-keys", // Sender announcing his PGP keys
  // "application/pkcs7-mime", // S/MIME encrypted
  // "application/pgp-encrypted", // PGP encrypted
];

/** An email, chat message or calendar event that can have attachments */
export interface MessageWithAttachments {
  dbID: number | string;
  readonly attachments: ArrayColl<Attachment>;
  newAttachment(): Attachment;
  /** Fetches the attachment contents, for messages that don't have them in memory */
  loadAttachments?(): Promise<void>;
}

/** Attaches files that the user picked or dropped */
export function addFilesAsAttachments(message: MessageWithAttachments, files: File[]): void {
  for (let file of files) {
    let attachment = message.newAttachment();
    attachment.fromFile(file);
    message.attachments.add(attachment);
  }
}

export interface AttachmentStorage {
  /** Whether this class can save and read attachment content at all */
  supportsAttachments: boolean;
  /** @returns whether this storage was able to read this concrete attachment
   * and has written the the content (and optionally metadata) to its variables. */
  readAttachment(attachment: Attachment): Promise<boolean>;
  /** May be a no-op, if this storage provider cannot save attachments individually,
   * but only e.g. as part of an email */
  saveAttachment(attachment: Attachment): Promise<void>;
  /** @see save, same limitations */
  deleteAttachment(attachment: Attachment): Promise<void>;
}
