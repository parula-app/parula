import { addonHookPoints, addonPermissions } from "./Permissions";
import { appName, appVersion } from "../build";
import { UserError, removeControlCharacters } from "../util/util";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { gt } from "../../l10n/l10n";
import { ArrayColl, type Collection, type MapColl } from "svelte-collections";

/** A button, menu item or frame that the addon adds to a place in the UI */
export interface AddonUIContribution {
  /** e.g. "message-toolbar" */
  place: string;
  id: string;
  label: string | null;
  /** Path of an SVG file in the package */
  icon: string | null;
  /** Sent to the addon's `main` code, when the user clicks */
  command: string | null;
  /** Path of a UI module that opens in a popup, when the user clicks */
  popup: string | null;
  /** Path of a UI module that shows in a frame at this place */
  entry: string | null;
  maxHeight: number | null;
}

export interface AddonProtocolContribution {
  id: string;
  /** mail, chat, calendar, contacts or files */
  type: string;
  label: string;
  /** Path of the UI module of the account setup */
  setup: string;
}

export interface AddonAppContribution {
  id: string;
  name: string;
  icon: string | null;
  entry: string;
}

/** The `package.json` of an addon, with its `mustang` key, validated */
export class AddonManifest {
  /** The npm package name. Identifies the addon. */
  id: string;
  version: string;
  /** Shown to the user */
  name: string;
  description: string = "";
  author: string = "";
  homepage: string | null = null;
  license: string | null = null;
  /** Path of an SVG file in the package */
  icon: string | null = null;
  minAppVersion: string | null = null;
  /** IDs of `addonPermissions` */
  readonly permissions = new ArrayColl<string>();
  /** https origins, optionally with "*." */
  readonly hosts = new ArrayColl<string>();
  /** Path of the logic script, which runs in a worker */
  main: string | null = null;
  readonly ui = new ArrayColl<AddonUIContribution>();
  readonly protocols = new ArrayColl<AddonProtocolContribution>();
  /** Hook point IDs, e.g. "mail.send" */
  readonly hooks = new ArrayColl<string>();
  readonly apps = new ArrayColl<AddonAppContribution>();

  /**
   * @param json The parsed `package.json`, or `toJSON()`
   * @param files All files in the package, to check the paths.
   *   null for a manifest whose files were already checked during the install.
   * @throws UserError with the reason, if anything is wrong or beyond the limits
   */
  static fromJSON(json: any, files: MapColl<string, Uint8Array> | null): AddonManifest {
    let manifest = new AddonManifest();
    manifest.read(json, files);
    return manifest;
  }

  protected read(json: any, files: MapColl<string, Uint8Array> | null) {
    this.checkObject(json, "package.json");
    this.id = this.checkString(json.name, "name", 214);
    if (!/^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/.test(this.id)) {
      throw new UserError(gt`The addon name ${this.id} is not a valid npm package name`);
    }
    this.version = this.checkVersion(json.version, "version");
    this.description = this.checkLabel(json.description, "description", 500, "");
    this.author = this.checkLabel(typeof json.author == "object" ? json.author?.name : json.author, "author", 100, "");
    this.license = this.checkLabel(json.license, "license", 100, null);
    this.homepage = this.checkHomepage(json.homepage, "homepage");

    let mustang = json.mustang;
    this.checkObject(mustang, "mustang");
    this.name = this.checkLabel(mustang.name, "mustang.name", 40);
    this.icon = this.checkFile(mustang.icon, "mustang.icon", files, ".svg", false);
    if (mustang.minAppVersion != null) {
      this.minAppVersion = this.checkVersion(mustang.minAppVersion, "mustang.minAppVersion");
      if (this.compareVersions(appVersion.split("-")[0], this.minAppVersion) < 0) {
        throw new UserError(gt`The addon needs ${appName} version ${this.minAppVersion} or newer`);
      }
    }
    for (let [i, id] of this.checkList(mustang.permissions, "mustang.permissions", addonPermissions.size).entries()) {
      let field = `mustang.permissions[${i}]`;
      this.checkString(id, field, 50);
      if (!addonPermissions.has(id)) {
        throw new UserError(gt`${field}: The permission ${id} is unknown`);
      }
      if (!this.permissions.includes(id)) {
        this.permissions.add(id);
      }
    }
    for (let [i, host] of this.checkList(mustang.hosts, "mustang.hosts", 20).entries()) {
      host = this.checkHost(host, `mustang.hosts[${i}]`);
      if (!this.hosts.includes(host)) {
        this.hosts.add(host);
      }
    }
    this.main = this.checkFile(mustang.main, "mustang.main", files, ".js", false);
    this.readUI(mustang.ui, files);
    this.readProtocols(mustang.protocols, files);
    this.readHooks(mustang.hooks);
    this.readApps(mustang.apps, files);
    let needsMain = this.ui.some(contribution => !!contribution.command) || this.protocols.hasItems || this.hooks.hasItems;
    if (needsMain && !this.main) {
      throw new UserError(gt`mustang.main is missing. The addon has commands, protocols or hooks, which run in it.`);
    }
  }

  protected readUI(ui: any, files: MapColl<string, Uint8Array> | null) {
    const kButtonPlaces = ["message-toolbar", "message-menu", "composer-toolbar"];
    const kFramePlaces = ["message-panel"];
    if (ui == null) {
      return;
    }
    this.checkObject(ui, "mustang.ui");
    for (let place of Object.keys(ui)) {
      if (!kButtonPlaces.includes(place) && !kFramePlaces.includes(place)) {
        throw new UserError(gt`mustang.ui: The place ${place} is unknown`);
      }
      let ids = new ArrayColl<string>();
      for (let [i, json] of this.checkList(ui[place], `mustang.ui.${place}`, 5).entries()) {
        let field = `mustang.ui.${place}[${i}]`;
        this.checkObject(json, field);
        let contribution: AddonUIContribution = {
          place,
          id: this.checkID(json.id, field + ".id", ids),
          label: null,
          icon: null,
          command: null,
          popup: null,
          entry: null,
          maxHeight: null,
        };
        if (kButtonPlaces.includes(place)) {
          contribution.label = this.checkLabel(json.label, field + ".label", 40);
          contribution.icon = this.checkFile(json.icon, field + ".icon", files, ".svg", false);
          contribution.command = json.command == null ? null : this.checkID(json.command, field + ".command");
          contribution.popup = this.checkFile(json.popup, field + ".popup", files, ".js", false);
          if (!contribution.command == !contribution.popup) {
            throw new UserError(gt`${field} needs either a command or a popup`);
          }
        } else {
          contribution.entry = this.checkFile(json.entry, field + ".entry", files, ".js", true);
          contribution.maxHeight = json.maxHeight == null ? null : this.checkInteger(json.maxHeight, field + ".maxHeight", 1, 2000);
        }
        this.ui.add(contribution);
      }
    }
  }

  protected readProtocols(protocols: any, files: MapColl<string, Uint8Array> | null) {
    const kTypes = ["mail", "chat", "calendar", "contacts", "files"];
    let ids = new ArrayColl<string>();
    for (let [i, json] of this.checkList(protocols, "mustang.protocols", 5).entries()) {
      let field = `mustang.protocols[${i}]`;
      this.checkObject(json, field);
      this.protocols.add({
        id: this.checkID(json.id, field + ".id", ids),
        type: sanitize.enum(json.type, kTypes, null) ?? this.invalid(field + ".type"),
        label: this.checkLabel(json.label, field + ".label", 40),
        setup: this.checkFile(json.setup, field + ".setup", files, ".js", true),
      });
    }
  }

  protected readHooks(hooks: any) {
    for (let [i, point] of this.checkList(hooks, "mustang.hooks", addonHookPoints.size).entries()) {
      let field = `mustang.hooks[${i}]`;
      this.checkString(point, field, 50);
      let group = addonHookPoints.get(point);
      if (!group) {
        throw new UserError(gt`${field}: The hook ${point} is unknown`);
      }
      if (!this.permissions.some(id => addonPermissions.get(id).apiGroups.includes(group))) {
        throw new UserError(gt`${field}: The hook ${point} needs the permission ${group}`);
      }
      if (!this.hooks.includes(point)) {
        this.hooks.add(point);
      }
    }
  }

  protected readApps(apps: any, files: MapColl<string, Uint8Array> | null) {
    let ids = new ArrayColl<string>();
    for (let [i, json] of this.checkList(apps, "mustang.apps", 5).entries()) {
      let field = `mustang.apps[${i}]`;
      this.checkObject(json, field);
      this.apps.add({
        id: this.checkID(json.id, field + ".id", ids),
        name: this.checkLabel(json.name, field + ".name", 40),
        icon: this.checkFile(json.icon, field + ".icon", files, ".svg", false),
        entry: this.checkFile(json.entry, field + ".entry", files, ".js", true),
      });
    }
  }

  protected checkObject(value: any, field: string) {
    if (!value || typeof value != "object" || Array.isArray(value)) {
      throw new UserError(gt`${field} is missing`);
    }
  }

  protected checkString(value: any, field: string, maxLength: number): string {
    if (value == null || value === "") {
      throw new UserError(gt`${field} is missing`);
    }
    if (typeof value != "string") {
      this.invalid(field);
    }
    if (value.length > maxLength) {
      throw new UserError(gt`${field} is too long. At most ${maxLength} characters are allowed.`);
    }
    return value;
  }

  /** Text shown to the user */
  protected checkLabel(value: any, field: string, maxLength: number, fallback?: string | null): string | null {
    if (typeof value == "string") {
      value = value.trim();
    }
    if ((value == null || value === "") && fallback !== undefined) {
      return fallback;
    }
    let label = this.checkString(value, field, maxLength);
    if (removeControlCharacters(label) != label) {
      this.invalid(field);
    }
    return sanitize.nonemptylabel(label);
  }

  protected checkID(value: any, field: string, existingIDs?: ArrayColl<string>): string {
    let id = sanitize.alphanumdash(this.checkString(value, field, 64), null) ?? this.invalid(field);
    if (existingIDs?.includes(id)) {
      throw new UserError(gt`${field}: The ID ${id} is used twice`);
    }
    existingIDs?.add(id);
    return id;
  }

  protected checkInteger(value: any, field: string, min: number, max: number): number {
    return Number.isInteger(value) ? sanitize.integerRange(value, min, max, null) ?? this.invalid(field) : this.invalid(field);
  }

  protected checkList(value: any, field: string, maxCount: number): any[] {
    if (value == null) {
      return [];
    }
    if (!Array.isArray(value)) {
      this.invalid(field);
    }
    if (value.length > maxCount) {
      throw new UserError(gt`${field} has too many entries. At most ${maxCount} are allowed.`);
    }
    return value;
  }

  protected checkVersion(value: any, field: string): string {
    let version = this.checkString(value, field, 64);
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(version)) {
      throw new UserError(gt`${field}: ${version} is not a version number like 1.2.0`);
    }
    return version;
  }

  protected checkHomepage(value: any, field: string): string | null {
    if (value == null || value === "") {
      return null;
    }
    let url = this.checkString(value, field, 1000);
    return URL.canParse(url) ? sanitize.url(url, null) ?? this.invalid(field) : this.invalid(field);
  }

  /** @returns the origin for the CSP, e.g. "https://api.example.com" or "https://*.example.com:8443" */
  protected checkHost(value: any, field: string): string {
    let host = this.checkString(value, field, 300).toLowerCase();
    let match = /^https:\/\/(\*\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(:\d{1,5})?$/.exec(host);
    if (!match) {
      throw new UserError(gt`${field}: ${host} is not allowed. Only https://host.example.com, https://*.example.com and a port are allowed.`);
    }
    let [, , hostname, port] = match;
    // The URL parser reads a host with a numeric last part as IPv4 address, e.g. "1.2.3.4" or "0x7f.1"
    let topLabel = hostname.split(".").pop();
    if (/^\d+$/.test(topLabel) || /^0x[0-9a-f]*$/.test(topLabel)) {
      throw new UserError(gt`${field}: IP addresses are not allowed`);
    }
    if ([".localhost", ".local", ".internal", ".home.arpa"].some(suffix => ("." + hostname).endsWith(suffix))) {
      throw new UserError(gt`${field}: Local network names are not allowed`);
    }
    if (port && sanitize.portTCP(port.substring(1), null) == null) {
      this.invalid(field);
    }
    return host;
  }

  /**
   * @param value Path relative to the package root
   * @returns the path as key in `files`, or null if not given and not required
   */
  protected checkFile(value: any, field: string, files: MapColl<string, Uint8Array> | null, extension: ".js" | ".svg", required: boolean): string | null {
    const kMaxIconSize = 50 * 1024;
    if (value == null && !required) {
      return null;
    }
    let path = this.checkString(value, field, 300).replace(/^(\.\/)+/, "");
    if (!path.toLowerCase().endsWith(extension)) {
      throw new UserError(gt`${field}: The file ${path} must be a ${extension} file`);
    }
    if (!files) {
      return path;
    }
    let contents = files.get(path);
    if (!contents) {
      throw new UserError(gt`${field}: The file ${path} is not in the addon`);
    }
    if (extension == ".svg") {
      if (contents.length > kMaxIconSize) {
        throw new UserError(gt`${field}: The file ${path} is too large. At most ${kMaxIconSize / 1024} KB are allowed.`);
      }
      if (!/<svg[\s>]/.test(new TextDecoder().decode(contents))) {
        throw new UserError(gt`${field}: The file ${path} is not an SVG image`);
      }
    }
    return path;
  }

  toJSON(): any {
    let ui: Record<string, any[]> = {};
    for (let contribution of this.ui) {
      let { place, ...json } = contribution;
      ui[place] ??= [];
      ui[place].push(json);
    }
    return {
      name: this.id,
      version: this.version,
      description: this.description,
      author: this.author,
      license: this.license,
      homepage: this.homepage,
      mustang: {
        name: this.name,
        icon: this.icon,
        minAppVersion: this.minAppVersion,
        permissions: this.permissions.contents,
        hosts: this.hosts.contents,
        main: this.main,
        ui,
        protocols: this.protocols.contents,
        hooks: this.hooks.contents,
        apps: this.apps.contents,
      },
    };
  }

  protected invalid(field: string): never {
    throw new UserError(gt`${field} has an invalid value`);
  }

  /** The permission IDs and hosts that the addon asks for. Each is one line in the install prompt. */
  get requestedPermissions(): ArrayColl<string> {
    let requested = new ArrayColl(this.permissions.contents);
    if (!this.permissions.includes("network.any")) {
      requested.addAll(this.hosts);
    }
    return requested;
  }

  /**
   * For an update, or to check the install
   * @param granted Permission IDs and hosts that the user already granted
   * @returns the requested permissions and hosts that the user has not granted yet
   */
  permissionsAddedTo(granted: Collection<string>): ArrayColl<string> {
    let anyHost = granted.includes("network.any");
    return new ArrayColl(this.requestedPermissions.contents.filter(permission =>
      !granted.includes(permission) && !(anyHost && permission.startsWith("https://"))));
  }

  /** The CSP `connect-src` for the addon's code */
  get connectSrc(): string {
    if (this.permissions.includes("network.any")) {
      return "https:";
    }
    if (this.hosts.hasItems) {
      return this.hosts.join(" ");
    }
    return "'none'";
  }

  isNewerThan(previous: AddonManifest): boolean {
    return this.compareVersions(this.version, previous.version) > 0;
  }

  /** Semantic versioning: 1.2.0 < 1.10.0, and 1.0.0-beta.2 < 1.0.0-beta.10 < 1.0.0
   * @returns > 0, if `a` is higher than `b`; < 0 if lower; 0 if the same */
  protected compareVersions(a: string, b: string): number {
    let [aCore, aPre] = this.versionParts(a);
    let [bCore, bPre] = this.versionParts(b);
    for (let i = 0; i < 3; i++) {
      if (aCore[i] != bCore[i]) {
        return aCore[i] - bCore[i];
      }
    }
    if (!aPre.length || !bPre.length) {
      return bPre.length - aPre.length;
    }
    for (let i = 0; i < Math.min(aPre.length, bPre.length); i++) {
      let aNum = /^\d+$/.test(aPre[i]);
      let bNum = /^\d+$/.test(bPre[i]);
      if (aNum && bNum && Number(aPre[i]) != Number(bPre[i])) {
        return Number(aPre[i]) - Number(bPre[i]);
      }
      if (aNum != bNum) {
        return aNum ? -1 : 1;
      }
      if (aPre[i] != bPre[i]) {
        return aPre[i] < bPre[i] ? -1 : 1;
      }
    }
    return aPre.length - bPre.length;
  }

  protected versionParts(version: string): [number[], string[]] {
    let [core, ...pre] = version.split("+")[0].split("-");
    return [core.split(".").map(Number), pre.length ? pre.join("-").split(".") : []];
  }
}

/** An addon read from a `.tgz` file, validated, but not installed yet */
export class AddonPackage {
  readonly manifest: AddonManifest;
  /** path -> contents */
  readonly files: MapColl<string, Uint8Array>;
  /** File name or URL that the user installs it from */
  readonly source: string;

  constructor(manifest: AddonManifest, files: MapColl<string, Uint8Array>, source: string) {
    this.manifest = manifest;
    this.files = files;
    this.source = source;
  }
}
