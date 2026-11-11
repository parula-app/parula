import { ExchangeAddressbook } from "./ExchangeAddressbook";
import { AddressbookShareCombinedPermissions } from "../Addressbook";
import type { PersonUID } from "../../Abstract/PersonUID";
import { EWSPerson } from "./EWSPerson";
import { EWSGroup } from "./EWSGroup";
import type { EWSAccount, EWSSubscribable } from "../../Mail/EWS/EWSAccount";
import { ConnectionPurpose } from "../../Mail/EWS/ConnectionPurpose";
import { getSharedPersons, ExchangePermission, deleteExchangePermissions, setExchangePermissions } from "../../Mail/EWS/ExchangePermission";
import { kMaxCount } from "../../Mail/EWS/EWSFolder";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, ensureArray } from "../../util/util";
import { Lock } from "../../util/flow/Lock";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";

export class EWSAddressbook extends ExchangeAddressbook implements EWSSubscribable {
  readonly protocol: string = "addressbook-ews";
  /** Exchange FolderID for this addressbook. Not DistinguishedFolderId */
  folderID: string;
  declare readonly persons: ArrayColl<EWSPerson>;
  declare readonly groups: ArrayColl<EWSGroup>;

  get account(): EWSAccount {
    assert(this.mainAccount, gt`Address book ${this.name} lost the connection to its account`);
    return this.mainAccount as EWSAccount;
  }

  newPerson(): EWSPerson {
    return new EWSPerson(this);
  }
  newGroup(): EWSGroup {
    return new EWSGroup(this);
  }

  get isLoggedIn(): boolean {
    return this.account.isLoggedIn;
  }

  async disconnect(): Promise<void> {
    await this.account.unsubscribeNotifications(this);
  }

  async login(interactive: boolean): Promise<void> {
    await super.login(interactive);
    if (this.username != this.account.username) {
      // Folders of the main user are covered by its `SubscribeToAllFolders`
      await this.account.subscribeToNotificationsForSubaccount(this);
    }
  }

  async listContacts() {
    await super.listContacts();

    return this.updateChangedContacts();
  }

  protected readonly listContactsLock = new Lock();

  // Uses the sync state to get just the contats that changed since last time.
  protected async updateChangedContacts() {
    let lock = await this.listContactsLock.lock();
    try {
      let sync = {
        m$SyncFolderItems: {
          m$ItemShape: {
            t$BaseShape: "IdOnly",
          },
          m$SyncFolderId: {
            t$FolderId: {
              Id: this.folderID,
            },
          },
          m$SyncState: this.syncState,
          m$MaxChangesReturned: kMaxCount,
        }
      };
      let persons: any[] = [];
      let groups: any[] = [];
      let result: any = { IncludesLastItemInRange: "false" };
      while (result.IncludesLastItemInRange === "false") {
        try {
          result = await this.account.callEWS(sync, ConnectionPurpose.Fetch);
        } catch (ex) {
          if (ex.error?.ResponseCode != 'ErrorInvalidSyncStateData') {
            throw ex;
          }
          this.syncState = null;
          await this.save();
          sync.m$SyncFolderItems.m$SyncState = null;
          result = await this.account.callEWS(sync, ConnectionPurpose.Fetch);
        }
        for (let changes of [result.Changes.Update, result.Changes.Create]) {
          if (changes) {
            for (let change of ensureArray(changes)) {
              if (change.Contact) {
                persons.push(change.Contact);
              }
              if (change.DistributionList) {
                groups.push(change.DistributionList);
              }
            }
          }
        }
        if (result.Changes.Delete) {
          for (let deletion of ensureArray(result.Changes.Delete)) {
            let person = this.getPersonByItemID(sanitize.nonemptystring(deletion.ItemId.Id));
            if (person) {
              this.persons.remove(person);
              await person.deleteLocally();
            }
            let group = this.getGroupByItemID(sanitize.nonemptystring(deletion.ItemId.Id));
            if (group) {
              this.groups.remove(group);
              await group.deleteLocally();
            }
          }
        }
        this.syncState = sync.m$SyncFolderItems.m$SyncState = sanitize.nonemptystring(result.SyncState);
      }
      await this.listPersons(persons);
      await this.listGroups(groups);
      await this.save();
    } finally {
      lock.release();
    }
  }

  // Lists all contacts and adds them to the persons and groups.
  // If you don't want this, then clear the sync state and update changes.
  // Updates any contacts that have been loaded from the db.
  async listAllContacts() {
    let request = {
      m$FindItem: {
        m$ItemShape: {
          t$BaseShape: "IdOnly",
        },
        m$IndexedPageItemView: {
          BasePoint: "Beginning",
          Offset: 0,
        },
        m$ParentFolderIds: {
          t$FolderId: [{
            Id: this.folderID,
          }],
        },
        Traversal: "Shallow",
      },
    };
    let persons: any[] = [];
    let groups: any[] = [];
    let result: any = { RootFolder: { IncludesLastItemInRange: "false" } };
    while (result?.RootFolder?.IncludesLastItemInRange === "false") {
      result = await this.account.callEWS(request, ConnectionPurpose.Fetch);
      if (!result?.RootFolder?.Items) {
        break;
      }
      request.m$FindItem.m$IndexedPageItemView.Offset = sanitize.integer(result.RootFolder.IndexedPagingOffset);
      if (result.RootFolder.Items.Contact) {
        persons = persons.concat(ensureArray(result.RootFolder.Items.Contact));
      }
      if (result.RootFolder.Items.DistributionList) {
        groups = groups.concat(ensureArray(result.RootFolder.Items.DistributionList));
      }
    }
    await this.listPersons(persons);
    await this.listGroups(groups);
  }

  async listPersons(persons: any[]) {
    for (let i = 0; i < persons.length; i += kMaxCount) {
      let batch = persons.slice(i, i + kMaxCount);
      let request = {
        m$GetItem: {
          m$ItemShape: {
            t$BaseShape: "Default",
            t$BodyType: "Text",
            t$AdditionalProperties: {
              t$FieldURI: [{
                FieldURI: "contacts:Department",
              }, {
                FieldURI: "contacts:GivenName",
              }, {
                FieldURI: "contacts:Surname",
              }, {
                FieldURI: "item:Body", // contact:Notes doesn't work
              }, {
                FieldURI: "item:Attachments", // The picture is an attachment
              }],
            },
          },
          m$ItemIds: {
            t$ItemId: batch.map(person => person.ItemId),
          },
        },
      };
      let results = ensureArray(await this.account.callEWS(request, ConnectionPurpose.Fetch));
      for (let result of results) {
        try {
          let person = this.getPersonByItemID(sanitize.nonemptystring(result.Items.Contact.ItemId.Id)) ??
            new EWSPerson(this);
          person.fromXML(result.Items.Contact);
          await person.saveLocally();
        } catch (ex) {
          this.account.errorCallback(ex);
        }
      }
    }
    // The pictures are slow and not vital, so they come only after all contacts
    await this.downloadPictures(this.persons.contents);
  }

  /** Exchange saves the pictures as attachments of the contacts,
   * so they need an extra call, but all pictures of a batch fit in one call.
   * Downloads only the pictures that changed, @see `ExchangePerson.needsPicture` */
  async downloadPictures(persons: EWSPerson[]) {
    let needPicture = persons.filter(person => person.needsPicture);
    for (let i = 0; i < needPicture.length; i += kMaxCount) {
      let batch = needPicture.slice(i, i + kMaxCount);
      try {
        let results = ensureArray(await this.account.callEWS({
          m$GetAttachment: {
            m$AttachmentIds: {
              t$AttachmentId: batch.map(person => ({
                Id: person.pictureAttachmentID,
              })),
            },
          },
        }, ConnectionPurpose.Fetch));
        for (let result of results) {
          let attachment = result.Attachments.FileAttachment;
          let attachmentID = sanitize.nonemptystring(attachment.AttachmentId.Id);
          let person = batch.find(person => person.pictureAttachmentID == attachmentID);
          if (person) {
            person.pictureFromServer(sanitize.nonemptystring(attachment.Content), sanitize.nonemptystring(attachment.ContentType, ""));
            await person.saveLocally();
          }
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
  }

  protected getPersonByItemID(id: string): EWSPerson | undefined {
    return this.persons.find(p => p.itemID == id);
  }

  async listGroups(groups: any[]) {
    for (let i = 0; i < groups.length; i += kMaxCount) {
      let batch = groups.slice(i, i + kMaxCount);
      let request = {
        m$GetItem: {
          m$ItemShape: {
            t$BaseShape: "IdOnly",
            t$BodyType: "Text",
            t$AdditionalProperties: {
              t$FieldURI: [{
                FieldURI: "item:Body",
              }, {
                FieldURI: "contacts:DisplayName",
              }, {
                FieldURI: "distributionlist:Members",
              }],
            },
          },
          m$ItemIds: {
            t$ItemId: batch.map(group => group.ItemId),
          },
        },
      };
      let results = ensureArray(await this.account.callEWS(request, ConnectionPurpose.Fetch));
      for (let result of results) {
        try {
          let group = this.getGroupByItemID(sanitize.nonemptystring(result.Items.DistributionList.ItemId.Id));
          if (group) {
            group.fromXML(result.Items.DistributionList);
            await group.saveLocally();
          } else {
            group = new EWSGroup(this);
            group.fromXML(result.Items.DistributionList);
            await group.saveLocally();
            this.groups.add(group);
          }
        } catch (ex) {
          this.account.errorCallback(ex);
        }
      }
    }
  }

  protected getGroupByItemID(id: string): EWSGroup | undefined {
    return this.groups.find(p => p.itemID == id);
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    let request = {
      m$GetFolder: {
        m$FolderShape: {
          t$BaseShape: "IdOnly",
          t$AdditionalProperties: {
            t$FieldURI: {
              FieldURI: "folder:PermissionSet",
            },
          },
        },
        m$FolderIds: {
          t$FolderId: {
            Id: this.folderID,
          },
        },
      },
    };
    let result = await this.account.callEWS(request);
    return getSharedPersons(ensureArray(result.Folders.ContactsFolder.PermissionSet.Permissions.Permission), this.account.emailAddress);
  }

  async deleteSharedPerson(otherPerson: PersonUID) {
    await deleteExchangePermissions(this, otherPerson);
  }

  get sharePermissionLevels(): AddressbookShareCombinedPermissions[] {
    return [AddressbookShareCombinedPermissions.Read, AddressbookShareCombinedPermissions.Modify];
  }

  async addSharedPerson(otherPerson: PersonUID, access: AddressbookShareCombinedPermissions) {
    await setExchangePermissions(this, otherPerson, access);
  }

  async getPermissions(): Promise<ExchangePermission[]> {
    let request = {
      m$GetFolder: {
        m$FolderShape: {
          t$BaseShape: "IdOnly",
          t$AdditionalProperties: {
            t$FieldURI: {
              FieldURI: "folder:PermissionSet",
            },
          },
        },
        m$FolderIds: {
          t$FolderId: {
            Id: this.folderID,
          },
        },
      },
    };
    let result = await this.account.callEWS(request);
    return ensureArray(result.Folders.ContactsFolder.PermissionSet.Permissions.Permission).map(permission => new ExchangePermission(permission));
  }

  async setPermissions(permissions: ExchangePermission[]) {
    let request = {
      m$UpdateFolder: {
        m$FolderChanges: {
          t$FolderChange: {
            t$FolderId: {
              Id: this.folderID,
            },
            t$Updates: {
              t$SetFolderField: {
                t$FieldURI: {
                  FieldURI: "folder:PermissionSet",
                },
                t$ContactsFolder: {
                  t$PermissionSet: {
                    t$Permissions: {
                      t$Permission: permissions.map(permission => permission.toEWSFolderPermission()),
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    await this.account.callEWS(request);
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.folderID = sanitize.string(json.folderID, null);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.folderID = this.folderID;
    return json;
  }
}
