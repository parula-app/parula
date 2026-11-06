import type { EWSCalendar } from "./EWSCalendar";
import type { EWSAccount } from "../../Mail/EWS/EWSAccount";
import { MAPIAddressBookEntryID, MAPIEntryID, MAPIStoreEntryID } from "../../Mail/EWS/MAPIEntryID";
import { PersonUID } from "../../Abstract/PersonUID";
import { ensureArray } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class EWSCalendarShortcut {
  readonly account: EWSAccount;
  readonly itemClass: string | null;
  readonly type: number | null;
  readonly section: number | null;
  readonly folderEntryID: MAPIEntryID;
  readonly storeEntryID: MAPIStoreEntryID;
  readonly addressBookEntryID: MAPIAddressBookEntryID;

  static readonly kFolderName = "Common Views";
  static readonly kItemClass = "IPM.Microsoft.WunderBar.Link";
  static readonly kSharedFolderType = 2;
  static readonly kCalendarSection = 3;
  static readonly kProperties = {
    type: { tag: 0x6849, type: "Integer" },
    section: { tag: 0x6852, type: "Integer" },
    folderEntryID: { tag: 0x684C, type: "Binary" },
    storeEntryID: { tag: 0x684E, type: "Binary" },
    addressBookEntryID: { tag: 0x6854, type: "Binary" },
  };

  /** @param item as returned by `FindItem` in `listCalendars()` */
  constructor(account: EWSAccount, item: any) {
    this.account = account;
    let values = new Map<number, string>();
    for (let property of ensureArray(item?.ExtendedProperty)) {
      values.set(Number(property?.ExtendedFieldURI?.PropertyTag), property?.Value);
    }
    let properties = EWSCalendarShortcut.kProperties;
    this.itemClass = sanitize.string(item?.ItemClass, null);
    this.type = sanitize.integer(values.get(properties.type.tag), null);
    this.section = sanitize.integer(values.get(properties.section.tag), null);
    this.folderEntryID = new MAPIEntryID(values.get(properties.folderEntryID.tag));
    this.storeEntryID = new MAPIStoreEntryID(values.get(properties.storeEntryID.tag));
    this.addressBookEntryID = new MAPIAddressBookEntryID(values.get(properties.addressBookEntryID.tag));
  }

  static async listCalendars(account: EWSAccount): Promise<EWSCalendar[]> {
    let folderID = await EWSCalendarShortcut.findFolderID(account);
    if (!folderID) {
      return [];
    }
    let request = {
      m$FindItem: {
        Traversal: "Associated",
        m$ItemShape: {
          t$BaseShape: "IdOnly",
          t$AdditionalProperties: {
            t$FieldURI: {
              FieldURI: "item:ItemClass",
            },
            t$ExtendedFieldURI: Object.values(EWSCalendarShortcut.kProperties).map(property => ({
              PropertyTag: "0x" + property.tag.toString(16).toUpperCase(),
              PropertyType: property.type,
            })),
          },
        },
        m$ParentFolderIds: {
          t$FolderId: {
            Id: folderID,
          },
        },
      },
    };
    let result = await account.callEWS(request);
    let items: any[] = Object.values(result.RootFolder?.Items ?? {}).flatMap(items => ensureArray(items));
    let calendars: EWSCalendar[] = [];
    for (let item of items) {
      let shortcut = new EWSCalendarShortcut(account, item);
      if (!shortcut.isCalendarOfOtherUser) {
        continue;
      }
      try {
        let calendar = await shortcut.createCalendar();
        if (calendar && !calendars.some(other => other.folderID == calendar.folderID)) {
          calendars.push(calendar);
        }
      } catch (ex) {
        if (!EWSCalendarShortcut.isStaleError(ex)) {
          account.dataError(ex);
        }
      }
    }
    return calendars;
  }

  static isStaleError(ex: any): boolean {
    return [
      "ErrorNameResolutionNoResults",
      "ErrorNonExistentMailbox",
      "ErrorFolderNotFound",
      "ErrorItemNotFound",
      "ErrorAccessDenied",
    ].includes(ex?.type);
  }

  protected static async findFolderID(account: EWSAccount): Promise<string | null> {
    let request = {
      m$FindFolder: {
        Traversal: "Shallow",
        m$FolderShape: {
          t$BaseShape: "IdOnly",
          t$AdditionalProperties: {
            t$FieldURI: {
              FieldURI: "folder:DisplayName",
            },
          },
        },
        m$ParentFolderIds: {
          t$DistinguishedFolderId: {
            Id: "root",
          },
        },
      },
    };
    let result = await account.callEWS(request);
    let folders: any[] = Object.values(result.RootFolder?.Folders ?? {}).flatMap(folders => ensureArray(folders));
    let commonViews = folders.find(folder => folder?.DisplayName == EWSCalendarShortcut.kFolderName);
    return sanitize.nonemptystring(commonViews?.FolderId?.Id, null);
  }

  get ownerLegacyDN(): string | null {
    return this.addressBookEntryID.legacyDN ?? this.storeEntryID.mailboxDN;
  }

  get hasFolder(): boolean {
    return this.folderEntryID.bytes.length > 0;
  }

  get isCalendarOfOtherUser(): boolean {
    return this.itemClass == EWSCalendarShortcut.kItemClass &&
      this.section == EWSCalendarShortcut.kCalendarSection &&
      this.type == EWSCalendarShortcut.kSharedFolderType &&
      !!this.ownerLegacyDN &&
      (this.hasFolder || !!this.addressBookEntryID.legacyDN);
  }

  async createCalendar(): Promise<EWSCalendar | null> {
    let owner = await this.resolveOwner();
    if (!owner || this.account.isMyEMailAddress(owner.emailAddress)) {
      return null;
    }
    let folderID = this.hasFolder
      ? {
        t$FolderId: {
          Id: await this.convertFolderEntryID(owner.emailAddress),
        },
      }
      : {
        t$DistinguishedFolderId: {
          Id: "calendar",
          t$Mailbox: {
            t$EmailAddress: owner.emailAddress,
          },
        },
      };
    let request = {
      m$GetFolder: {
        m$FolderShape: {
          t$BaseShape: "Default",
          t$AdditionalProperties: {
            t$FieldURI: [{
              FieldURI: "folder:FolderClass",
            }, {
              FieldURI: "folder:DistinguishedFolderId",
            }],
          },
        },
        m$FolderIds: folderID,
      },
    };
    let result = await this.account.callEWS(request);
    let folder = result.Folders?.CalendarFolder;
    if (folder?.FolderClass != "IPF.Appointment") {
      return null;
    }
    return this.account.createCalendarAccount(folder, {
      name: owner.nameOrEMail,
      username: owner.emailAddress,
      color: this.account.colorForSharedAccount(owner),
    });
  }

  protected async resolveOwner(): Promise<PersonUID | null> {
    let request = {
      m$ResolveNames: {
        ReturnFullContactData: false,
        SearchScope: "ActiveDirectory",
        m$UnresolvedEntry: this.ownerLegacyDN,
      },
    };
    let response = await this.account.callEWS(request);
    let resolutions = ensureArray(response.ResolutionSet?.Resolution);
    if (resolutions.length != 1) {
      return null;
    }
    let mailbox = resolutions[0].Mailbox;
    let emailAddress = sanitize.emailAddress(mailbox?.EmailAddress, null);
    if (!emailAddress) {
      return null;
    }
    return new PersonUID(emailAddress, sanitize.nonemptylabel(mailbox.Name, null) ?? undefined);
  }

  protected async convertFolderEntryID(mailbox: string): Promise<string> {
    let request = {
      m$ConvertId: {
        DestinationFormat: "EwsId",
        m$SourceIds: {
          t$AlternateId: {
            Format: "HexEntryId",
            Id: this.folderEntryID.hex,
            Mailbox: mailbox,
          },
        },
      },
    };
    let response = await this.account.callEWS(request);
    return sanitize.nonemptystring(response.AlternateId?.Id);
  }
}
