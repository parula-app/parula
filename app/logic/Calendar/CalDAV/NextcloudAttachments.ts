import type { Attachment } from "../../Abstract/Attachment";
import type { CalDAVCalendar } from "./CalDAVCalendar";
import { NextcloudAccount } from "../../Files/Nextcloud/NextcloudAccount";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { Buffer } from "buffer";

/**
 * Nextcloud and ownCloud cannot save the file in the event. They save it as a
 * normal file of the user, and reference it in the event only by URL. Their web
 * app shows only such attachments, and ignores files that are inline in the event.
 *
 * The file stays in the user's files, even when he removes the attachment from
 * the event, or deletes the event. That's how the Nextcloud web app does it, too.
 * <https://github.com/nextcloud/calendar/blob/main/src/services/attachmentService.js>
 */
export class NextcloudAttachments {
  /** The files of the same server, with the same login */
  protected readonly files: NextcloudAccount;

  /**
   * Nextcloud and ownCloud serve the calendars of user `pete` at
   * `https://cloud.example.com/remote.php/dav/calendars/pete/personal/`
   * and his files at `https://cloud.example.com/remote.php/dav/files/pete/`.
   * @returns null, if this is not a Nextcloud or ownCloud server
   */
  static forCalendar(calendar: CalDAVCalendar): NextcloudAttachments | null {
    let match = /^(.*\/remote\.php\/dav\/)calendars\/([^\/]+)\//.exec(calendar.calendarURL ?? "");
    return match
      ? new NextcloudAttachments(calendar, `${match[1]}files/${match[2]}/`)
      : null;
  }

  constructor(calendar: CalDAVCalendar, filesURL: URLString) {
    this.files = new NextcloudAccount();
    this.files.name = calendar.name;
    this.files.url = filesURL;
    this.files.authMethod = calendar.authMethod;
    this.files.username = calendar.username;
    this.files.password = calendar.password;
    this.files.oAuth2 = calendar.oAuth2 ?? calendar.mainAccount?.oAuth2;
  }

  /** Uploads the file into the user's files.
   * @returns where the file is now, @see `Attachment.url` */
  async upload(attachment: Attachment): Promise<URLString> {
    assert(attachment.content, gt`Attachment file is missing`);
    await this.files.login(false);
    await this.createFolder();
    let filename = await this.freeFilename(attachment.filename);
    let bytes = Buffer.from(await attachment.content.arrayBuffer()); // Buffer needed for JPC
    // `overwrite: false` returns false, if the file appeared in the meantime
    let written = await this.files.client.putFileContents(`/${kAttachmentsFolder}/${filename}`, bytes, { overwrite: false });
    assert(written, gt`Uploading the attachment failed`);
    return new URL(`${kAttachmentsFolder}/${encodeURIComponent(filename)}`, this.files.url).href;
  }

  /** Fetches the file that the event references.
   * @returns the file contents, or null, if it's not a file of this server */
  async download(attachment: Attachment): Promise<File | null> {
    let url = new URL(attachment.url);
    let filesURL = new URL(this.files.url);
    if (url.origin != filesURL.origin) {
      return null; // A file elsewhere, e.g. a Google Drive link
    }
    let filesPath = filesURL.pathname.replace(/\/$/, "");
    let bytes: ArrayBuffer;
    if (url.pathname.startsWith(filesPath + "/")) {
      await this.files.login(false);
      let path = url.pathname.slice(filesPath.length)
        .split("/").map(decodeURIComponent).join("/");
      bytes = await this.files.client.getFileContents(path, { format: "binary" }) as ArrayBuffer;
    } else {
      let fileID = /\/f\/(\d+)$/.exec(url.pathname)?.[1];
      if (!fileID) {
        return null;
      }
      bytes = await this.downloadByFileID(fileID);
    }
    return new File([bytes], attachment.filename, { type: attachment.mimeType });
  }

  /** The Nextcloud web app references the file by its web page `/index.php/f/<fileID>`,
   * which shows the file in the web UI, but doesn't give us the file itself.
   * `direct` creates a download URL for it, which is valid for a few hours.
   * <https://github.com/nextcloud/server/blob/master/apps/dav/lib/Controller/DirectController.php> */
  protected async downloadByFileID(fileID: string): Promise<ArrayBuffer> {
    let json = await this.files.ocsCall("POST", "/ocs/v2.php/apps/dav/api/v1/direct", { fileId: fileID });
    let downloadURL = sanitize.url(json?.ocs?.data?.url);
    let ky = await appGlobal.remoteApp.kyCreate({ result: "arrayBuffer" });
    return await ky.get(downloadURL, {});
  }

  protected async createFolder(): Promise<void> {
    let path = `/${kAttachmentsFolder}`;
    if (!await this.files.client.exists(path)) {
      await this.files.client.createDirectory(path);
    }
  }

  /** All events save their attachments in the same folder, so a file with the
   * same name may already be there, from another event. Don't overwrite it. */
  protected async freeFilename(filename: string): Promise<string> {
    let ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
    let base = filename.slice(0, filename.length - ext.length);
    for (let i = 2; await this.files.client.exists(`/${kAttachmentsFolder}/${filename}`); i++) {
      filename = `${base} (${i})${ext}`;
    }
    return filename;
  }
}

/** Where the Nextcloud calendar web app saves the attachments, by default */
const kAttachmentsFolder = "Calendar";
