import type { Folder } from "../../../logic/Mail/Folder";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import type { PersonUID } from "../../../logic/Abstract/PersonUID";
import { MailShareCombinedPermissions, MailShareIndividualPermissions } from "../../../logic/Mail/Folder";
import { getBaseDomainFromHost, getDomainForEmailAddress } from "../../../logic/util/netUtil";
import { assert } from "../../../logic/util/util";
import { gt } from "../../../l10n/l10n";

export class FolderPermission {
  readonly person: PersonUID;
  readonly isNew: boolean;
  level: MailShareCombinedPermissions | null;
  rights: MailShareIndividualPermissions[];
  isChanged = false;

  constructor(person: PersonUID, isNew: boolean, level: MailShareCombinedPermissions | null = null) {
    this.person = person;
    this.isNew = isNew;
    this.level = level;
    this.rights = level ? FolderPermissions.rightsOf(level) : [];
  }

  get name(): string {
    return this.person.name || this.person.emailAddress;
  }
}

export class FolderPermissions {
  readonly account: MailAccount;
  readonly folder: Folder;
  entries: FolderPermission[] = [];
  removed: FolderPermission[] = [];
  allFolders = false;
  includeSubfolders = true;

  constructor(folder: Folder) {
    this.folder = folder;
    this.account = folder.account;
  }

  get canShare(): boolean {
    return this.account.canShareWithPersons() && this.account.sharePermissionLevels.length > 0;
  }

  async load() {
    let persons = await this.account.getSharedPersons();
    this.entries = persons.contents.map(person => new FolderPermission(person, false));
    this.removed = [];
  }

  add(person: PersonUID): FolderPermission {
    let existing = this.entries.find(entry => entry.person.emailAddress == person.emailAddress);
    if (existing) {
      return existing;
    }
    assert(getBaseDomainFromHost(getDomainForEmailAddress(person.emailAddress)) ==
      getBaseDomainFromHost(getDomainForEmailAddress(this.account.emailAddress)),
      gt`You can only share with users in your company`);
    let entry = new FolderPermission(person, true, this.account.sharePermissionLevels[0]);
    this.entries.push(entry);
    return entry;
  }

  remove(entry: FolderPermission) {
    this.entries = this.entries.filter(candidate => candidate != entry);
    if (!entry.isNew) {
      this.removed.push(entry);
    }
  }

  setLevel(entry: FolderPermission, level: MailShareCombinedPermissions) {
    entry.level = level;
    if (level != MailShareCombinedPermissions.Custom) {
      entry.rights = FolderPermissions.rightsOf(level);
    }
    entry.isChanged = true;
  }

  setRight(entry: FolderPermission, right: MailShareIndividualPermissions, granted: boolean) {
    let rights = entry.rights.filter(existing => existing != right);
    if (granted) {
      rights.push(right);
    }
    entry.rights = rights;
    entry.level = this.account.sharePermissionLevels.includes(MailShareCombinedPermissions.Custom)
      ? FolderPermissions.levelOf(rights)
      : entry.level;
    entry.isChanged = true;
  }

  get isChanged(): boolean {
    return this.removed.length > 0 || this.entries.some(entry => entry.isNew || entry.isChanged);
  }

  async apply() {
    for (let entry of this.removed) {
      await this.account.deleteSharedPerson(entry.person);
    }
    this.removed = [];
    for (let entry of this.entries.filter(candidate => candidate.isNew || candidate.isChanged)) {
      assert(entry.level, gt`Please choose a permission level for ${entry.name}`);
      let custom = entry.level == MailShareCombinedPermissions.Custom ? entry.rights : [];
      await this.account.addSharedPerson(entry.person, this.allFolders ? null : this.folder,
        this.includeSubfolders, entry.level, ...custom);
      entry.isChanged = false;
    }
    this.entries = this.entries.map(entry => entry.isNew ? new FolderPermission(entry.person, false, entry.level) : entry);
  }

  static rightsOf(level: MailShareCombinedPermissions): MailShareIndividualPermissions[] {
    switch (level) {
      case MailShareCombinedPermissions.Read:
        return [MailShareIndividualPermissions.Read];
      case MailShareCombinedPermissions.FlagChange:
        return [MailShareIndividualPermissions.Read, MailShareIndividualPermissions.FlagChange];
      case MailShareCombinedPermissions.Modify:
        return [MailShareIndividualPermissions.Read, MailShareIndividualPermissions.FlagChange,
          MailShareIndividualPermissions.Create, MailShareIndividualPermissions.Delete];
      default:
        return [];
    }
  }

  static levelOf(rights: MailShareIndividualPermissions[]): MailShareCombinedPermissions {
    for (let level of [MailShareCombinedPermissions.Read, MailShareCombinedPermissions.FlagChange, MailShareCombinedPermissions.Modify]) {
      let preset = FolderPermissions.rightsOf(level);
      if (preset.length == rights.length && preset.every(right => rights.includes(right))) {
        return level;
      }
    }
    return MailShareCombinedPermissions.Custom;
  }

  static levelLabel(level: MailShareCombinedPermissions): string {
    switch (level) {
      case MailShareCombinedPermissions.Read:
        return gt`Reviewer *=> Permission level: may only read the emails`;
      case MailShareCombinedPermissions.FlagChange:
        return gt`Reviewer, can flag and categorize`;
      case MailShareCombinedPermissions.Modify:
        return gt`Editor *=> Permission level: may read, create, change and delete emails`;
      default:
        return gt`Custom`;
    }
  }

  static rightLabel(right: MailShareIndividualPermissions): string {
    switch (right) {
      case MailShareIndividualPermissions.Read:
        return gt`Read items *=> Permission to read the emails`;
      case MailShareIndividualPermissions.FlagChange:
        return gt`Change flags and categories`;
      case MailShareIndividualPermissions.Create:
        return gt`Create items`;
      case MailShareIndividualPermissions.Delete:
        return gt`Delete items`;
      case MailShareIndividualPermissions.CreateSubfolders:
        return gt`Create subfolders`;
      case MailShareIndividualPermissions.DeleteFolder:
        return gt`Delete this folder`;
    }
  }
}
