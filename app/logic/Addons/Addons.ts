import { Addon } from "./Addon";
import { AddonManifest, AddonPackage } from "./AddonManifest";
import { DesktopAddonFiles, IndexedDBAddonFiles, type AddonFiles } from "./AddonFiles";
import { gunzip, readStreamBounded, readTar } from "../util/tar";
import { Lock } from "../util/flow/Lock";
import { dataError, minorError } from "../util/error";
import { UserError } from "../util/util";
import { isMobile } from "../build";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { gt } from "../../l10n/l10n";
import { ArrayColl, MapColl, type Collection } from "svelte-collections";

const kMaxPackageSize = 20 * 1024 * 1024;

/** The installed addons. `appGlobal.addons` */
export class Addons {
  readonly installed = new ArrayColl<Addon>();
  protected installLock = new Lock();

  get(id: string): Addon | undefined {
    return this.installed.find(addon => addon.id == id);
  }

  /**
   * Reads a `.tgz` file, as made by `npm pack`, for the install prompt.
   * @param source File name or URL, shown to the user
   * @throws UserError with the reason, if the package is invalid
   */
  async readPackage(bytes: Uint8Array, source: string): Promise<AddonPackage> {
    const kMaxUnpackedSize = 50 * 1024 * 1024;
    const kMaxFiles = 1000;
    if (bytes.length > kMaxPackageSize) {
      throw new UserError(gt`The addon file is larger than ${kMaxPackageSize / 1024 / 1024} MB`);
    }
    let archive: MapColl<string, Uint8Array>;
    try {
      // Headers and padding of the tar format come on top of the file contents
      let tar = await gunzip(bytes, kMaxUnpackedSize + (kMaxFiles + 20) * 1024);
      archive = readTar(tar, kMaxFiles, kMaxUnpackedSize);
    } catch (ex) {
      throw new UserError(gt`The addon file is not a valid package: ${ex.message}`);
    }
    let files = this.packageFiles(archive);
    let packageJSON = files.get("package.json");
    if (!packageJSON) {
      throw new UserError(gt`The addon has no package.json`);
    }
    let json: any;
    try {
      json = JSON.parse(new TextDecoder().decode(packageJSON));
    } catch (ex) {
      throw new UserError(gt`The package.json of the addon is invalid: ${ex.message}`);
    }
    return new AddonPackage(AddonManifest.fromJSON(json, files), files, source);
  }

  /** `npm pack` puts all files into `package/`. Removes that, and checks that the paths work on all OSes. */
  protected packageFiles(archive: MapColl<string, Uint8Array>): MapColl<string, Uint8Array> {
    let prefix = [...archive.keys()].every(path => path.startsWith("package/")) ? "package/" : "";
    let files = new MapColl<string, Uint8Array>();
    let lowerCasePaths = new Set<string>();
    for (let [archivePath, contents] of archive.entries()) {
      let path = archivePath.substring(prefix.length);
      if (/[<>:"|?*]/.test(path)) {
        throw new UserError(gt`The addon has a file name that is not allowed: ${path}`);
      }
      if (lowerCasePaths.has(path.toLowerCase())) {
        throw new UserError(gt`The addon has the file ${path} twice, with different upper and lower case`);
      }
      lowerCasePaths.add(path.toLowerCase());
      files.set(path, contents);
    }
    return files;
  }

  /**
   * Downloads a `.tgz` file, for the install prompt.
   * @param url https only
   * @throws UserError with the reason
   */
  async downloadPackage(url: string): Promise<AddonPackage> {
    if (!URL.canParse(url) || !sanitize.url(url, null, ["https"])) {
      throw new UserError(gt`The address of the addon must start with https://`);
    }
    let response = await fetch(url, { credentials: "omit" });
    if (!response.ok) {
      throw new UserError(gt`Could not download the addon. The server answered with error ${response.status}.`);
    }
    if (response.url && !response.url.startsWith("https:")) {
      throw new UserError(gt`The server redirected the download of the addon to a non-https address`);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readStreamBounded(response.body, kMaxPackageSize);
    } catch (ex) {
      throw new UserError(gt`Could not download the addon: ${ex.message}`);
    }
    return await this.readPackage(bytes, url);
  }

  /**
   * Installs and starts the addon.
   * @param grantedPermissions What the user confirmed in the install prompt.
   *   Must be all of `pkg.manifest.requestedPermissions`.
   * @throws UserError, e.g. if it's already installed, or not all permissions were granted.
   *   If only the start failed, the addon stays installed, with `state == AddonState.Error`.
   */
  async install(pkg: AddonPackage, grantedPermissions: Collection<string>): Promise<Addon> {
    if (isMobile) {
      throw new UserError(gt`Addons are not available on mobile yet`);
    }
    let manifest = pkg.manifest;
    let addon: Addon;
    let lock = await this.installLock.lock();
    try {
      if (this.get(manifest.id)) {
        throw new UserError(gt`The addon ${manifest.name} is already installed`);
      }
      if (manifest.permissionsAddedTo(grantedPermissions).hasItems) {
        throw new UserError(gt`The addon ${manifest.name} needs permissions that you did not grant`);
      }
      addon = new Addon(this, manifest, this.newFiles(manifest.id));
      addon.grantedPermissions.addAll(manifest.requestedPermissions);
      await addon.files.writePackage(manifest.version, pkg.files);
      this.installed.add(addon);
      this.save();
    } finally {
      lock.release();
    }
    await addon.enable();
    return addon;
  }

  /** At app start: Reads the list of installed addons, and starts the enabled ones in the background.
   * Never throws. */
  loadOnStartup(): void {
    if (isMobile) {
      return;
    }
    try {
      this.load();
    } catch (ex) {
      minorError(ex);
      return;
    }
    for (let addon of this.installed) {
      addon.startup()
        .catch(minorError);
    }
  }

  protected load(): void {
    let json = sanitize.array(JSON.parse(sanitize.nonemptystring(localStorage.getItem("addons"), "[]")), []);
    for (let addonJSON of json) {
      try {
        let manifest = AddonManifest.fromJSON(addonJSON?.manifest, null);
        if (this.get(manifest.id)) {
          continue;
        }
        let addon = new Addon(this, manifest, this.newFiles(manifest.id));
        addon.isEnabled = sanitize.boolean(addonJSON.enabled, false);
        let requested = manifest.requestedPermissions;
        addon.grantedPermissions.addAll(sanitize.array(addonJSON.granted, [])
          .filter(permission => typeof permission == "string" && requested.includes(permission)));
        this.installed.add(addon);
      } catch (ex) {
        dataError(ex);
      }
    }
  }

  save(): void {
    let json = this.installed.contents.map(addon => addon.toJSON());
    localStorage.setItem("addons", JSON.stringify(json));
  }

  protected newFiles(addonID: string): AddonFiles {
    // #if [!WEBMAIL]
    return new DesktopAddonFiles(addonID);
    // #else
    return new IndexedDBAddonFiles(addonID);
    // #endif
  }
}
