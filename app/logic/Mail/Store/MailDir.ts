import type { MailContentStorage } from "../MailAccount";
import type { EMail } from "../EMail";
import type { Folder } from "../Folder";
import type { Attachment } from "../../Abstract/Attachment";
import { getFilesDir } from "../../util/backend-wrapper";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { ArrayColl, SetColl } from "svelte-collections";

/** Save all emails of a mail folder in a folder in the local disk filesystem.
 * Each email is saved as original RFC822 MIME message, one file per email.
 * The email filename is the unique `dbID` of the email.
 * (It's also an option to use the msgID as filename, but mailing lists are terrible
 * and rewrite messages in various ways, but keep the msgID...).
 * This is similar to, but not the same as the standard "MailDir" from qmail. */
export class MailDir implements MailContentStorage {
  async save(email: EMail) {
    assert(email.mime, "Need MIME source to save the email in maildir");
    let filepath = await this.getFilePath(email);
    // Permissions: Only user can read the file, but not modify
    await appGlobal.remoteApp.writeFile(filepath, 0o400, email.mime);
  }

  async read(email: EMail): Promise<void> {
    try {
      email.mime = await appGlobal.remoteApp.readFile(await this.getFilePath(email));
    } catch (ex) {
      if (ex.code != "ENOENT") {
        throw ex;
      }
    }
  }

  /** All emails of the folder, as saved on disk. E.g. to restore a lost database. */
  async readAll(folder: Folder): Promise<ArrayColl<EMail>> {
    let emails = new ArrayColl<EMail>();
    let dir = await this.getFolderDir(folder);
    for (let file of await appGlobal.remoteApp.fs.readdir(dir) as string[]) {
      try {
        let email = folder.newEMail();
        email.mime = await appGlobal.remoteApp.readFile(dir + "/" + file);
        await email.parseMIME();
        emails.add(email);
      } catch (ex) {
        folder.account.errorCallback(ex);
      }
    }
    return emails;
  }

  async deleteIt(email: EMail): Promise<void> {
    try {
      await appGlobal.remoteApp.deleteFile(await this.getFilePath(email));
    } catch (ex) {
      if (ex.code != "ENOENT") {
        throw ex;
      }
    }
  }

  supportsAttachments = true;
  async readAttachment(attachment: Attachment): Promise<boolean> {
    let email = attachment.message as EMail;
    if (!email.mime) {
      await this.read(email);
    }
    if (!email.mime) {
      return false;
    }
    await email.parseMIME();
    return true;
  }
  async saveAttachment(attachment: Attachment): Promise<void> {
    await this.save(attachment.message as EMail);
  }
  async deleteAttachment(attachment: Attachment): Promise<void> {
  }

  filesDir: string | null = null;
  haveDirs = new SetColl<string>(); // Check dir only once per app session

  async getFolderDir(folder: Folder): Promise<string> {
    this.filesDir = this.filesDir ?? await getFilesDir();
    let dir = `${this.filesDir}/backup/email/individual/${sanitize.filename(folder.account.emailAddress.replace("@", "-"))}-${sanitize.filename(folder.account.id)}`;
    for (let name of folder.fullPath.split("/")) {
      dir += `/${sanitize.filename(name, "unknownFolder")}`;
    }
    if (!this.haveDirs.contains(dir)) {
      // Permissions: Only user can read and write the dir.
      await appGlobal.remoteApp.fs.mkdir(dir, { recursive: true, mode: 0o700 });
      this.haveDirs.add(dir);
    }
    return dir;
  }

  async getFilePath(email: EMail): Promise<string> {
    assert(email.dbID, "Please save the email first in the database, so that we can use the dbID as filename");
    let dir = await this.getFolderDir(email.folder);
    return `${dir}/${sanitize.filename(email.dbID + "")}.eml`;
  }
}
