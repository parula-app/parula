import { File } from "../File";
import type { WebDAVDirectory } from "./WebDAVDirectory";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { Buffer } from "buffer";
import type { URLString } from "../../util/util";
import type { FileStat } from "webdav";

export class WebDAVFile extends File {
  declare parent: WebDAVDirectory;
  /** URL of the file on the WebDAV server.
   * Can HTTP GET, but only with auth headers, not loadable from the frontend. */
  serverURL: URLString | null = null;

  get account() {
    return this.parent?.account;
  }

  get etag(): string | null {
    return this.syncState as string;
  }
  set etag(val: string | null) {
    this.syncState = val;
  }

  fromDAV(stat: FileStat) {
    this.path = sanitize.nonemptystring(stat.filename);
    this.setFileName(sanitize.filename(stat.basename));
    this.mimetype = sanitize.nonemptystring(stat.mime, this.mimetype ?? "");
    let size = sanitize.integer(stat.size, 0)
    let etag = sanitize.nonemptystring(stat.etag, null);
    let lastMod = sanitize.date(stat.lastmod, new Date());
    if (this.lastModOnServer?.getTime() == this.lastMod.getTime() &&
        (this.size != size || this.etag != etag ||
         this.lastModOnServer?.getTime() != lastMod.getTime())) {
      this.deleteStaleLocalCache()
        .catch(this.account.errorCallback);
    }
    this.size = size;
    this.etag = etag;
    if (this.lastMod.getTime() != lastMod.getTime()) {
      this.lastMod = lastMod;
    }
    if (this.lastModOnServer?.getTime() != this.lastMod.getTime()) {
      this.lastModOnServer = new Date(this.lastMod); // Make copy, not same object
    }
    this.serverURL = sanitize.url(new URL(this.path, this.account.url).href, null);
  }

  async download() {
    if (this.contents) {
      return;
    }
    await this.readLocalFile();
    if (this.contents) {
      return;
    }
    await this.downloadRunOnce.runOnce(async () => {
      if (this.contents) {
        return;
      }
      await this.account.login(false);
      let buffer = await this.account.client.getFileContents(this.path, { format: "binary" }) as ArrayBuffer;
      let blob = new Blob([buffer], this.mimetype ? { type: this.mimetype } : undefined);
      await this.saveContentsLocally(blob);
    });
  }

  async upload(): Promise<void> {
    await this.readLocalFile();
    await this.saveContentsOnServer(this.contents);
  }

  async saveContents(contents: Blob) {
    await this.saveContentsLocally(contents);
    await this.saveContentsOnServer(contents);
  }

  async saveContentsLocally(contents: Blob) {
    this.clearURL();
    this.contents = contents;
    await this.saveAsLocalFile();
  }

  async saveContentsOnServer(contents: Blob) {
    await this.account.login(false);
    let bytes = Buffer.from(await contents.arrayBuffer()); // Buffer needed for JPC
    let headers: Record<string, string> = {};
    if (this.etag) {
      headers["If-Match"] = this.etag;
    }
    await this.account.client.putFileContents(this.path, bytes, {
      overwrite: true,
      headers,
    });
    await this.stat();
  }

  /** Refresh metadata for this file from the server.
   * WebDAV: PROPFIND on the single file. */
  async stat() {
    await this.account.login(false);
    let stat = await this.account.client.stat(this.path) as FileStat;
    this.fromDAV(stat);
  }

  /** Save renames and lastMod changes to the server.
   * Size and mimetype are server-computed, so we don't send them. */
  async saveOnServer() {
    let renamedPath = this.parent.childPath(this.name);
    let nameChanged = renamedPath != this.path;
    let lastModChanged = this.lastModOnServer &&
      this.lastMod.getTime() != this.lastModOnServer.getTime();
    if (!nameChanged && !lastModChanged) {
      return;
    }
    await this.account.login(false);
    if (nameChanged) {
      await this.account.client.moveFile(this.path, renamedPath);
      this.path = renamedPath;
      this.serverURL = sanitize.url(new URL(this.path, this.account.url).href, null);
      await this.parent.listContents();
    }
    if (lastModChanged) {
      try {
        // PROPPATCH on D:getlastmodified. Honored by SabreDAV, Nextcloud,
        // ownCloud, openCloud. Plain WebDAV treats it as protected and 403s.
        let xml = `<?xml version="1.0" encoding="utf-8"?>\n` +
          `<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop>` +
          `<D:getlastmodified>${this.lastMod.toUTCString()}</D:getlastmodified>` +
          `</D:prop></D:set></D:propertyupdate>`;
        await this.account.client.customRequest(this.path, {
          method: "PROPPATCH",
          headers: { "Content-Type": "application/xml; charset=utf-8" },
          data: xml,
        });
      } catch (ex) {
        if (ex.message?.includes("403")) { // TODO test
          console.log(ex);
        } else {
          throw ex;
        }
      }
      this.lastModOnServer = this.lastMod;
    }
  }

  async deleteOnServer() {
    await this.account.login(false);
    await this.account.client.deleteFile(this.path);
  }

  /** Convert a full WebDAV server-relative path
   *   /remote.php/dav/files/<user>/Documents/foo.docx
   * to a path rooted at the user root
   *   /Documents/foo.docx
   * Uses the account URL as the base — `this.url` is the file's blob: URL
   * and is unset until `getURL()` runs. */
  userRelativePath(webdavPath: string): string {
    let prefix = new URL(this.account.url).pathname;
    if (!prefix.endsWith("/")) {
      prefix += "/";
    }
    if (webdavPath.startsWith(prefix)) {
      return "/" + webdavPath.slice(prefix.length);
    }
    return webdavPath;
  }
}
