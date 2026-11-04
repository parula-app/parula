import JPCWebSocket from '../../lib/jpc-ws';
import { production } from '../../app/logic/build';
import { Database } from "@radically-straightforward/sqlite"; // formerly @leafac/sqlite
import Zip from "adm-zip";
import { createType1Message, decodeType2Message, createType3Message } from "../../desktop/backend/ntlm"; // TODO move to lib/?
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

// TODO Remove backend OWA.* entirely and
// use standard HTTP requests and Auth window.
const OWA = {
  fetchSessionData() {
    return null;
  }
};

let jpc: JPCWebSocket | null = null;

export async function startupBackend(jpcSecret: string) {
  let appGlobal = await createSharedAppObject();
  jpc = new JPCWebSocket(appGlobal);
  await jpc.listen(jpcSecret, production ? 5455 : 5453, false);
}

export async function shutdownBackend() {
  await jpc.stopListening();
  jpc = null;
}

/** Returns a passcode with at least 32 chars. Only alpha-num-dash. */
export function createJPCSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function createSharedAppObject() {
  return {
    kyCreate,
    optionsHTTP,
    postHTTP,
    streamHTTP,
    OWA,
    newOSNotification,
    isOSNotificationSupported,
    setTrayIcon,
    setBadgeCount,
    minimizeMainWindow,
    unminimizeMainWindow,
    maximizeMainWindow,
    addEventListenerWebContents,
    getWebContents,
    writeTextToClipboard,
    // openExternalURL,
    openFileInNativeApp,
    showFileInFolder,
    restartApp,
    setTheme,
    openMenu,
    // getConfigDir,
    // getFilesDir,
    // openFileInExternalApp,
    createIMAPFlowConnection,
    getSQLiteDatabase,
    sendMailNodemailer,
    verifyServerNodemailer,
    getMIMENodemailer,
    createWebDAVClient,
    createTSDAVClient,
    createType1Message,
    createType3MessageFromType2Message,
    getCACertificates,
    newAdmZIP,
    newHTTPServer,
    newHTTPConnection,
    newTCPSocket,
    startTLS,
    readFile,
    writeFile,
    getIconForLocalFile,
    getIconForFileType,
    getThumbnailForLocalFile,
    listDirectoryContents,
    fs: fsPromises,
    directory,
    platform,
    path: {
      dirname: path.dirname,
      join: path.join,
    },
  };
}

function getCACertificates(type: string) {
  if (tls.getCACertificates) {
    return tls.getCACertificates(type);
  }
  // Fallback for old node.js
  return type == "bundled" ? tls.rootCertificates : [];
}

function createType3MessageFromType2Message(WWWAuthenticate, username, password) {
  return createType3Message(decodeType2Message(WWWAuthenticate), username, password);
}

async function readFile(path: string): Promise<ArrayBufferLike> {
  let fileHandle = await fsPromises.open(path, "r");
  let { buffer } = await fileHandle.readFile();
  await fileHandle.close();
  return buffer;
}
async function writeFile(path: string, permissions: number, contents: Uint8Array): Promise<void> {
  await fsPromises.rm(path, { force: true });
  let fileHandle = await fsPromises.open(path, "w", permissions);
  await fileHandle.write(contents);
  await fileHandle.close();
}

/**
 * @param defaultOptions
 * @return Object with get(url, options), post(), put() etc. functions
 *   Either options or defaultOptions contain
 *   `result = "text"` or "json", "formData", "blob", "arrayBuffer",
 *   then directly calls `text()`, so that you can do fetch in one step with a single `await`.
 *
 * E.g.
 * ```js
 * let ky = await remoteApp.kyCreate({ prefixUrl: "https://api.example.com", result: "json" });
 * let json = await ky.get("users/");
 * ```
 * or (identical)
 * ```js
 * let ky = await remoteApp.kyCreate();
 * let json = await ky.get(https://api.example.com/users", { result: "json" });
 * ```
 */
async function kyCreate(defaultOptions) {
  /* `ky` (like axios) is both a function and acts like an object with functions get(), post() etc. as properties,
   * which confuses jpc, so make it only an object. */
  let kyObj = {};
  const { default: ky } = await import("ky");
  let kyFunc = ky.create(defaultOptions);
  for (let name in kyFunc) {
    kyObj[name] = async (input, options) => {
      // let resultKy = ky.post(input, options);
      let kyFetch = kyFunc[name](input, options);
      let resultType = options?.result || defaultOptions?.result;
      if (resultType &&
          ["text", "json", "formData", "blob", "arrayBuffer"].includes(resultType) &&
          ["get", "put", "post", "patch", "delete", "head"].includes(name)) {
        try {
          // console.log("Calling server", "input", input, "options", options, "defaults", defaultOptions);
          // let json = await resultKy.json();
          return await kyFetch[resultType]();
        } catch (ex) {
          throw new HTTPFetchError(ex);
        }
      } else {
        return kyFetch;
      }
    }
  }
  return kyObj;
}

export class HTTPFetchError extends Error {
  url: string;
  redirectedURL: string;
  code: string;
  httpCode: number;
  httpStatusText: string;
  httpMethod: string;
  hostname: string;
  /** `Retry-After`, in seconds, when the server rate-limited us */
  retryAfterSeconds: number;

  constructor(ex: Error) {
    super(ex?.message ?? ex + "");
    this.name = ex?.name ?? this.name; // own property, so it survives the JPC JSON serialization
    let request = (ex as any).request;
    let response = (ex as any).response;
    let cause = (ex as any).cause
    if (request && response) {
      this.url = request.url;
      this.redirectedURL = response.url != request.url ? response.url : undefined;
      this.httpCode = response.status;
      this.httpStatusText = response.statusText;
      this.httpMethod = request.method;
      this.hostname = new URL(this.url).hostname;
      this.retryAfterSeconds = parseInt(response.headers.get("Retry-After")) || undefined;
      this.message = `HTTP ${this.httpMethod} <${this.url}>${this.redirectedURL ? ` redirected to <${this.redirectedURL}>` : ''} failed with ${this.httpCode} ${this.httpStatusText}`;
    } else if (cause) {
      this.code = cause.code;
      this.hostname = cause.hostname;
      if (cause.code == "ENOTFOUND") {
        this.message = `HTTP host ${cause.hostname} not found`;
      } else if (cause.code == "ECONNREFUSED") {
        this.message = `HTTP host ${cause.hostname} connection refused`;
      }
    }
  }
}

/**
 * Perform an OPTIONS request to check the ActiveSync version.
 * @param config ky config @see <https://github.com/sindresorhus/ky>
 */
async function optionsHTTP(url: string, config: any) {
  // Sadly OPTIONS is not directly supported by ky
  config.method = 'OPTIONS';
  const { default: ky } = await import("ky");
  let response = await ky(url, config);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    WWWAuthenticate: response.headers.get("WWW-Authenticate"),
    MSASProtocolVersions: response.headers.get("MS-ASPRotocolVersions"),
    MSServerActiveSync: response.headers.get("MS-Server-ActiveSync"),
  };
}

/**
 * @param responseType "text", "json", "formData", "blob", "arrayBuffer"
 *    @see <https://developer.mozilla.org/en-US/docs/Web/API/Response#instance_methods>
 * @param config ky config @see <https://github.com/sindresorhus/ky>
 */
async function postHTTP(url: string, data: any, responseType: string, config: any) {
  switch (config.headers['Content-Type']) {
  case 'application/x-www-form-urlencoded':
    config.body = new URLSearchParams(data);
    break;
  case 'application/json':
    config.json = data;
    break;
  default:
    config.body = data;
    break;
  }
  const { default: ky } = await import("ky");
  let response = await ky.post(url, config);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    data: await response[responseType](),
    WWWAuthenticate: response.headers.get("WWW-Authenticate"),
  };
}

/**
 * @param config ky config @see <https://github.com/sindresorhus/ky>
 */
async function streamHTTP(url: string, data: any, config: any) {
  config.body = data;
  const { default: ky } = await import("ky");
  let response = await ky.post(url, config);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: response.body.pipeThrough(new TextDecoderStream()),
    WWWAuthenticate: response.headers.get("WWW-Authenticate"),
  };
}

async function newHTTPServer() {
  const { HTTPServer } = await import("../../desktop/backend/HTTPServer");
  return new HTTPServer();
}

/** A HTTP(S) client that runs all requests over a single TCP connection,
 * for connection-based authentication like NTLM. @see `HTTPConnection` */
async function newHTTPConnection(url: string, options?: any) {
  const { HTTPConnection } = await import("../../desktop/backend/HTTPConnection");
  return new HTTPConnection(url, options);
}

/** A new raw TCP socket, from the node net module.
 * You can attach `connect`/`error`/`data` listeners and `connect()` */
function newTCPSocket(): net.Socket {
  return new net.Socket();
}

/** Wraps a connected `newTCPSocket()` in TLS, for implicit TLS and STARTTLS.
 * Resolves once the handshake succeeded, so that you can attach listeners.
 * @param tlsOptions node `tls.ConnectionOptions`, e.g. `rejectUnauthorized: false`
 *   accepts self-signed and expired certificates, `minVersion: "TLSv1"` old servers. */
function startTLS(socket: net.Socket, hostname: string, tlsOptions?: tls.ConnectionOptions): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    let tlsSocket = tls.connect({ socket, servername: hostname, ...tlsOptions }, () => resolve(tlsSocket));
    tlsSocket.on("error", reject);
  });
}

function setTrayIcon(imgDataURL: string, tooltip: string, onClick: () => void) {
  // Mobile OSes have no system tray
}

function newOSNotification(options: any): Notification {
  throw new Error("Not implemented yet")
}

function isOSNotificationSupported(): boolean {
  return false; // TODO implement native notifications
}

function restartApp() { // TODO
}

function setTheme(theme: "system" | "light" | "dark") { // TODO
  if (!["system", "light", "dark"].includes(theme)) {
    throw new Error("Bad theme name " + theme);
  }
}

function openExternalURL(url: string) { // TODO
}

function openFileInNativeApp(filePath: string) { // TODO
}

function showFileInFolder(filePath: string) { // TODO
}


function openMenu(menuItems: MenuItemConstructorOptions[]): void { // TODO
}

async function createIMAPFlowConnection(...args): ImapFlow {
  const { ImapFlow } = await import("imapflow");
  return new ImapFlow(...args);
}

function getSQLiteDatabase(filename: string, options: any, buffer?: Uint8Array): Database {
  let safeOptions = { readonly: !!options?.readonly }; // `nativeBinding` in it would `require()` any file as native code
  if (buffer) {
    return new Database(Buffer.from(buffer), safeOptions);
  }
  return new Database(filename, safeOptions);
}

async function sendMailNodemailer(transport, mail) {
  const { createTransport } = await import("nodemailer");
  let transporter = createTransport(transport);
  await transporter.sendMail(mail);
}

async function verifyServerNodemailer(transport) {
  const { createTransport } = await import("nodemailer");
  let transporter = createTransport(transport);
  await transporter.verify();
}

async function getMIMENodemailer(mail, keepBcc = false): Promise<Uint8Array> {
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer");
  let composer = new MailComposer(mail);
  let message = composer.compile();
  message.keepBcc = keepBcc;
  let buffer = await message.build();
  return buffer;
}

async function createTSDAVClient(options: any) {
  const { DAVClient } = await import("tsdav");
  return new DAVClient(options);
}

async function createWebDAVClient(serverURL: string, options: any) {
  const { createClient } = await import("webdav");
  return createClient(serverURL, options);
}

function newAdmZIP(filepath: string) {
  try {
    return new Zip(filepath);
  } catch (ex) {
    // ZIP file does not exist yet
    // Relying on the message is fragile, but AdmZip unfortunately doesn't give us error codes.
    if (ex.message?.includes("Invalid filename") || ex.stack?.includes("Object.INVALID_FILENAME")) {
      // Create a new ZIP file.
      let zip = new Zip();
      zip.writeZip(filepath);
      return new Zip(filepath);
    } else {
      throw ex;
    }
  }
}

export function setMainWindow(mainWin) {
}

function minimizeMainWindow() {
  throw new Error("Not supported");
}

function unminimizeMainWindow() {
  throw new Error("Not supported");
}

function maximizeMainWindow() {
  throw new Error("Not supported");
}

function addEventListenerWebContents(webContentsID: number, webviewEvent: string, eventHandler: (event: Event) => void) {
  throw new Error("Not supported");
}

function getWebContents(webContentsID: number) {
  throw new Error("Not supported");
}

/**
 * Writes to system clipboard
 * Don't expose reading the clipboard because the user may have sensitive data
 * on their system clipboard e.g. passwords
 */
function writeTextToClipboard(text: string) { // TODO
}

function setBadgeCount(count: number) { // TODO
}

export interface FileStat {
  /** Filename */
  name: string;
  /** File path, including file name */
  path: string;
  /** true: is a directory, false: is a file */
  isDirectory: boolean;
  /** File size, in bytes */
  size: number | undefined;
  /** Time of last modification */
  lastMod: Date | undefined;
}

/**
 * Get the files and directories within a directory on the harddrive
 * @param dirPath path of the directory for which you want to see the contents
 * @param withStats includes size and last modification time (slower, extra work)
 * @param includeHidden include dotfiles (on Unix: name starting with ".")
 * @returns list of files and directories in the directory
 */
async function listDirectoryContents(dirPath: string, withStats = true, includeHidden = false): FileStat[] {
  let files = [] as FileStat[];
  let entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
  for (let entry of entries) {
    if (!includeHidden && entry.name[0] == ".") {
      continue;
    }
    let file = {} as FileStat;
    file.name = entry.name;
    file.path = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory()) {
      file.isDirectory = true;
    } else if (entry.isFile()) {
      file.isDirectory = false;
    } else {
      continue;
    }
    if (withStats) {
      let stat = await fsPromises.stat(file.path);
      file.size = stat.size;
      file.lastMod = stat.mtime;
    }
    files.push(file);
  }
  return files;
}

async function getIconForFileType(ext: string, mimetype: string): Promise<string> {
  return "";
}

async function getIconForLocalFile(fullPath: string): Promise<string> {
  return "";
}

async function getThumbnailForLocalFile(fullPath: string): Promise<string> {
  return "";
}

function platform(): string {
  return os.platform();
}

/** @param type
 *   e.g. "home", "appData" (`.config` and `%APPDATA%`), "userData" (app config)
 *   @see <https://www.electronjs.org/docs/latest/api/app#appgetpathname> */
function directory(type: string): string {
  return os.homedir();
}

// workaround: @capacitor/app App.getInfo().id has some code not getting bundled
const appID = "im.mustang.capa";
let configDir: string;
/**
 * Get the user config directory on disk.
 *
 * The files in here are useful mostly to the app itself, in internal data formats,
 * and not really useful without the app.
 * Consequently, this is a directory that is usually *not* shown to the user,
 * but still accessible, if needed by technical people or for backups.
 *
 * Linux: /home/USER/.mustang/
 * Windows: C:\Users\USER\AppData\Mustang\
 * Mac OS: /Users/USER/Library/Application Support/Mustang
 */
function getConfigDir(): string {
  if (configDir) {
    return configDir;
  }
  let homeDir: string = os.homedir();
  if (os.platform() == "android") {
    configDir = path.join(homeDir, "data", appID, "config");
  } else {
    configDir = homeDir;
  }
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir);
  }
  return configDir;
}

let filesDir: string;
/**
 * Get the directory on disk where we store the files that our user exchanged with others.
 * E.g. file sharing, email attachments, chat transfer files, and email backups.
 *
 * This should be a folder where the user can go to, but not right in the middle of his
 * personal documents and folders.
 *
 * TODO Change it
 * Linux: /home/USER/.mustang/
 * Windows: C:\Users\USER\AppData\Mustang\
 * Mac OS: /Users/USER/Library/Mustang
 */
function getFilesDir(): string {
  if (filesDir) {
    return filesDir;
  }
  let homeDir: string = os.homedir();
  if (os.platform() == "android") {
    filesDir = path.join(homeDir, "data", appID, "config");
  } else {
    filesDir = homeDir;
  }
  if (!fs.existsSync(filesDir)) {
    fs.mkdirSync(filesDir);
  }
  return filesDir;
}
