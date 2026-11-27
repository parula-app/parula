import type { Addons } from "./Addons";
import type { AddonSandbox } from "./AddonSandbox";
import type { AddonManifest, AddonPackage } from "./AddonManifest";
import { AddonStorage, type AddonFiles } from "./AddonFiles";
import { addonPermissions } from "./Permissions";
import type { AddonGroup } from "./API/addon";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { Lock } from "../util/flow/Lock";
import { minorError } from "../util/error";
import { sanitizeSVG } from "../util/convertHTML";
import { UserError, type URLString } from "../util/util";
import { gt } from "../../l10n/l10n";
import { ArrayColl, SetColl, type Collection } from "svelte-collections";

export enum AddonState {
  Enabled = "enabled",
  Disabled = "disabled",
  /** It should run, but failed. @see `Addon.error` */
  Error = "error",
}

/** Something that an addon added to the app, e.g. a button, a protocol, or its sandbox */
export interface AddonRegistration {
  unregister(): void | Promise<void>;
}

export class Addon extends Observable {
  readonly addons: Addons;
  @notifyChangedProperty
  manifest: AddonManifest;
  /** Permission IDs and hosts that the user granted */
  readonly grantedPermissions = new ArrayColl<string>();
  /** The user wants it to run */
  @notifyChangedProperty
  isEnabled = true;
  @notifyChangedProperty
  state = AddonState.Disabled;
  /** Why it could not start */
  @notifyChangedProperty
  error: Error | null = null;
  /** Undone in reverse order, when the addon stops */
  readonly registrations = new ArrayColl<AddonRegistration>();
  /** Where the addon code runs, while it runs */
  @notifyChangedProperty
  sandbox: AddonSandbox | null = null;
  readonly files: AddonFiles;
  readonly storage: AddonStorage;
  protected lifecycleLock = new Lock();

  constructor(addons: Addons, manifest: AddonManifest, files: AddonFiles) {
    super();
    this.addons = addons;
    this.manifest = manifest;
    this.files = files;
    this.storage = new AddonStorage(files);
  }

  /** npm package name */
  get id(): string {
    return this.manifest.id;
  }

  get name(): string {
    return this.manifest.name;
  }

  /** The `@addon("...")` groups whose members the addon may use */
  get apiGroups(): SetColl<AddonGroup> {
    let groups = new SetColl<AddonGroup>();
    for (let id of this.manifest.permissions) {
      if (this.grantedPermissions.includes(id)) {
        groups.addAll(addonPermissions.get(id).apiGroups);
      }
    }
    return groups;
  }

  /** @param path relative to the package root */
  async readFile(path: string): Promise<Uint8Array> {
    return await this.files.readFile(this.manifest.version, path);
  }

  /**
   * @param path of an SVG file in the package, e.g. `manifest.icon`
   * @returns `blob:` URL of the sanitized image. Revoke it with `URL.revokeObjectURL()`, when it no longer shows.
   */
  async iconURL(path: string): Promise<URLString> {
    let svg = sanitizeSVG(new TextDecoder().decode(await this.readFile(path)));
    if (!svg) {
      throw new Error(gt`The icon ${path} of the addon ${this.name} is not an SVG image`);
    }
    return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  }

  async enable(): Promise<void> {
    let lock = await this.lifecycleLock.lock();
    try {
      this.isEnabled = true;
      this.addons.save();
      await this.run();
    } finally {
      lock.release();
    }
  }

  async disable(): Promise<void> {
    let lock = await this.lifecycleLock.lock();
    try {
      this.isEnabled = false;
      this.addons.save();
      await this.stop();
    } finally {
      lock.release();
    }
  }

  /** Stops it, and deletes its files and data */
  async uninstall(): Promise<void> {
    let lock = await this.lifecycleLock.lock();
    try {
      await this.stop();
      this.addons.installed.remove(this);
      this.addons.save();
      try {
        await this.files.deleteAll();
      } catch (ex) {
        minorError(ex);
      }
    } finally {
      lock.release();
    }
  }

  /**
   * Replaces the addon with a newer version, and restarts it, if it was enabled.
   * @param newlyGranted Permissions and hosts that the user granted for the update,
   *   i.e. all of `pkg.manifest.permissionsAddedTo(this.grantedPermissions)`
   */
  async update(pkg: AddonPackage, newlyGranted: Collection<string> = new ArrayColl<string>()): Promise<void> {
    let manifest = pkg.manifest;
    let lock = await this.lifecycleLock.lock();
    try {
      if (manifest.id != this.id) {
        throw new UserError(gt`This is the addon ${manifest.id}, not ${this.id}`);
      }
      if (!manifest.isNewerThan(this.manifest)) {
        throw new UserError(gt`Version ${manifest.version} is not newer than the installed version ${this.manifest.version}`);
      }
      let granted = new ArrayColl(this.grantedPermissions.contents.concat(newlyGranted.contents));
      if (manifest.permissionsAddedTo(granted).hasItems) {
        throw new UserError(gt`The update needs permissions that you did not grant`);
      }
      await this.files.writePackage(manifest.version, pkg.files);
      let oldVersion = this.manifest.version;
      await this.stop();
      this.manifest = manifest;
      this.grantedPermissions.replaceAll(manifest.requestedPermissions);
      this.addons.save();
      try {
        await this.files.deletePackage(oldVersion);
      } catch (ex) {
        minorError(ex);
      }
      if (this.isEnabled) {
        await this.run();
      }
    } finally {
      lock.release();
    }
  }

  async startup(): Promise<void> {
    let lock = await this.lifecycleLock.lock();
    try {
      if (this.isEnabled) {
        await this.run();
      }
    } finally {
      lock.release();
    }
  }

  /** Starts it, if it doesn't run yet. On failure, sets `error` and throws. */
  protected async run(): Promise<void> {
    if (this.state == AddonState.Enabled) {
      return;
    }
    try {
      if (this.manifest.permissionsAddedTo(this.grantedPermissions).hasItems) {
        throw new UserError(gt`The addon ${this.name} needs permissions that you did not grant`);
      }
      await this.start();
      this.error = null;
      this.state = AddonState.Enabled;
    } catch (ex) {
      await this.unregisterAll();
      this.error = ex;
      this.state = AddonState.Error;
      throw ex;
    }
  }

  /** Starts the addon's code. It adds the sandbox, and everything that the addon adds to the app, to `registrations`. */
  protected async start(): Promise<void> {
    // Loaded only when needed. Its imports of the app classes would make an import cycle with app.ts.
    let { AddonSandbox } = await import("./AddonSandbox");
    let sandbox = new AddonSandbox(this);
    this.registrations.add(sandbox);
    this.sandbox = sandbox;
    await sandbox.start();
  }

  protected async stop(): Promise<void> {
    await this.unregisterAll();
    this.error = null;
    this.state = AddonState.Disabled;
  }

  protected async unregisterAll(): Promise<void> {
    const kMaxRegistrations = 100000;
    for (let i = 0; this.registrations.hasItems && i < kMaxRegistrations; i++) {
      let registration = this.registrations.pop();
      try {
        await registration.unregister();
      } catch (ex) {
        minorError(ex);
      }
    }
  }

  toJSON(): any {
    return {
      manifest: this.manifest.toJSON(),
      enabled: this.isEnabled,
      granted: this.grantedPermissions.contents,
    };
  }
}
