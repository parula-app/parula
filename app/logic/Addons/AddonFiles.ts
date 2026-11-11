import { appGlobal } from "../app";
import { getConfigDir } from "../util/backend-wrapper";
import { normalizeRelativePath } from "../util/tar";
import { Lock } from "../util/flow/Lock";
import { dataError } from "../util/error";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { MapColl } from "svelte-collections";

/** Stores the files of an installed addon, and its own data */
export abstract class AddonFiles {
  /** npm package name */
  readonly addonID: string;

  constructor(addonID: string) {
    this.addonID = addonID;
  }

  /** Writes all files of this version. If that fails, removes what it wrote. */
  async writePackage(version: string, files: MapColl<string, Uint8Array>): Promise<void> {
    try {
      await this.writeFiles(version, files);
    } catch (ex) {
      await this.deletePackage(version);
      throw ex;
    }
  }

  protected abstract writeFiles(version: string, files: MapColl<string, Uint8Array>): Promise<void>;
  /** @param path relative to the package root */
  abstract readFile(version: string, path: string): Promise<Uint8Array>;
  abstract deletePackage(version: string): Promise<void>;
  /** Deletes all versions, and the addon's own data */
  abstract deleteAll(): Promise<void>;
  /** @returns The JSON text that `writeStorage()` wrote, or null */
  abstract readStorage(): Promise<string | null>;
  abstract writeStorage(json: string): Promise<void>;
}

/** Desktop: In `<configDir>/addons/<npm name>/<version>/` */
export class DesktopAddonFiles extends AddonFiles {
  protected async dir(): Promise<string> {
    return `${await getConfigDir()}/addons/${this.fileName(this.addonID)}`;
  }

  /** A different file name for every different `text`, also on file systems that ignore case or trailing dots.
   * Keeps a-z, 0-9 and -, and writes every other character as _ and the hex codes of its bytes. */
  protected fileName(text: string): string {
    // <copied to="AddonProtocols.ts">
    return text.replace(/[^a-z0-9-]/gu, char =>
      [...new TextEncoder().encode(char)].map(byte => "_" + byte.toString(16).padStart(2, "0")).join(""));
    // </copied>
  }

  protected async writeFiles(version: string, files: MapColl<string, Uint8Array>): Promise<void> {
    let packageDir = `${await this.dir()}/${this.fileName(version)}`;
    let createdDirs = new Set<string>();
    for (let [path, contents] of files.entries()) {
      let filepath = `${packageDir}/${normalizeRelativePath(path)}`;
      let dir = filepath.substring(0, filepath.lastIndexOf("/"));
      if (!createdDirs.has(dir)) {
        await appGlobal.remoteApp.fs.mkdir(dir, { recursive: true, mode: 0o700 });
        createdDirs.add(dir);
      }
      await appGlobal.remoteApp.writeFile(filepath, 0o600, contents);
    }
  }

  async readFile(version: string, path: string): Promise<Uint8Array> {
    let filepath = `${await this.dir()}/${this.fileName(version)}/${normalizeRelativePath(path)}`;
    return new Uint8Array(await appGlobal.remoteApp.readFile(filepath));
  }

  async deletePackage(version: string): Promise<void> {
    await appGlobal.remoteApp.fs.rm(`${await this.dir()}/${this.fileName(version)}`, { recursive: true, force: true });
  }

  async deleteAll(): Promise<void> {
    await appGlobal.remoteApp.fs.rm(await this.dir(), { recursive: true, force: true });
  }

  async readStorage(): Promise<string | null> {
    try {
      let contents = await appGlobal.remoteApp.readFile(`${await this.dir()}/storage.json`);
      return new TextDecoder().decode(contents);
    } catch (ex) {
      if (ex.code == "ENOENT") {
        return null;
      }
      throw ex;
    }
  }

  async writeStorage(json: string): Promise<void> {
    let dir = await this.dir();
    await appGlobal.remoteApp.fs.mkdir(dir, { recursive: true, mode: 0o700 });
    // Replace the old file only once the new one is complete
    await appGlobal.remoteApp.writeFile(`${dir}/storage.json.new`, 0o600, new TextEncoder().encode(json));
    await appGlobal.remoteApp.fs.rename(`${dir}/storage.json.new`, `${dir}/storage.json`);
  }
}

/** Webmail: In the IndexedDB `addons` of the app */
export class IndexedDBAddonFiles extends AddonFiles {
  protected static db: Promise<IDBDatabase> | null = null;

  protected async openDB(): Promise<IDBDatabase> {
    IndexedDBAddonFiles.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request = indexedDB.open("addons", 1);
      request.onupgradeneeded = () => {
        // files: key [addon ID, version, path]; storage: key addon ID
        request.result.createObjectStore("files");
        request.result.createObjectStore("storage");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        IndexedDBAddonFiles.db = null;
        reject(request.error);
      };
    });
    return await IndexedDBAddonFiles.db;
  }

  /** Runs `change` in a transaction on `storeName`
   * @returns the result of the request that `change` returned, once the transaction completed */
  protected async transaction<T>(storeName: string, mode: IDBTransactionMode, change: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    let db = await this.openDB();
    return await new Promise<T | undefined>((resolve, reject) => {
      let transaction = db.transaction(storeName, mode);
      let request = change(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  protected async writeFiles(version: string, files: MapColl<string, Uint8Array>): Promise<void> {
    await this.transaction("files", "readwrite", store => {
      for (let [path, contents] of files.entries()) {
        store.put(contents, [this.addonID, version, normalizeRelativePath(path)]);
      }
    });
  }

  async readFile(version: string, path: string): Promise<Uint8Array> {
    let contents = await this.transaction("files", "readonly", store =>
      store.get([this.addonID, version, normalizeRelativePath(path)]));
    if (!(contents instanceof Uint8Array)) {
      throw new Error(`File ${path} not found in addon ${this.addonID}`);
    }
    return contents;
  }

  async deletePackage(version: string): Promise<void> {
    // Arrays sort after strings, so this includes all paths
    await this.transaction("files", "readwrite", store =>
      store.delete(IDBKeyRange.bound([this.addonID, version], [this.addonID, version, []])));
  }

  async deleteAll(): Promise<void> {
    await this.transaction("files", "readwrite", store =>
      store.delete(IDBKeyRange.bound([this.addonID], [this.addonID, []])));
    await this.transaction("storage", "readwrite", store => store.delete(this.addonID));
  }

  async readStorage(): Promise<string | null> {
    let json = await this.transaction("storage", "readonly", store => store.get(this.addonID));
    return typeof json == "string" ? json : null;
  }

  async writeStorage(json: string): Promise<void> {
    await this.transaction("storage", "readwrite", store => store.put(json, this.addonID));
  }
}

/** The addon's own data, which it reads and writes with `mustang.storage`. JSON values. */
export class AddonStorage {
  protected readonly files: AddonFiles;
  /** key -> value as JSON text */
  protected values: Promise<MapColl<string, string>> | null = null;
  /** Characters of all keys and values */
  protected size = 0;
  protected saveLock = new Lock();

  constructor(files: AddonFiles) {
    this.files = files;
  }

  /** @returns a copy of the value, or undefined, if there is none */
  async get(key: string): Promise<any> {
    let json = (await this.load()).get(this.checkKey(key));
    return json == null ? undefined : JSON.parse(json);
  }

  /** @throws if the value is not JSON, or the storage would exceed its quota of 10 MB */
  async set(key: string, value: any): Promise<void> {
    const kQuota = 10 * 1024 * 1024;
    key = this.checkKey(key);
    let json = JSON.stringify(value);
    if (json === undefined) {
      await this.remove(key);
      return;
    }
    let values = await this.load();
    let previous = values.get(key);
    let newSize = this.size - (previous == null ? 0 : key.length + previous.length) + key.length + json.length;
    if (newSize > kQuota) {
      throw new Error(`The addon storage is full. It allows at most ${kQuota} characters.`);
    }
    values.set(key, json);
    this.size = newSize;
    await this.save();
  }

  async remove(key: string): Promise<void> {
    key = this.checkKey(key);
    let values = await this.load();
    let previous = values.get(key);
    if (previous == null) {
      return;
    }
    values.delete(key);
    this.size -= key.length + previous.length;
    await this.save();
  }

  protected checkKey(key: string): string {
    if (typeof key != "string" || !key || key.length > 1000) {
      throw new Error("The storage key must be a string with 1 to 1000 characters");
    }
    return key;
  }

  protected async load(): Promise<MapColl<string, string>> {
    this.values ??= this.read();
    return await this.values;
  }

  protected async read(): Promise<MapColl<string, string>> {
    let values = new MapColl<string, string>();
    let text = await this.files.readStorage();
    if (text == null) {
      return values;
    }
    try {
      let json = sanitize.object(JSON.parse(text));
      for (let [key, value] of Object.entries(json)) {
        let valueJSON = JSON.stringify(value);
        values.set(key, valueJSON);
        this.size += key.length + valueJSON.length;
      }
    } catch (ex) {
      dataError(ex);
    }
    return values;
  }

  protected async save(): Promise<void> {
    let lock = await this.saveLock.lock();
    try {
      let values = await this.load();
      let json = "{" + [...values.entries()].map(([key, valueJSON]) => JSON.stringify(key) + ":" + valueJSON).join(",") + "}";
      await this.files.writeStorage(json);
    } finally {
      lock.release();
    }
  }
}
