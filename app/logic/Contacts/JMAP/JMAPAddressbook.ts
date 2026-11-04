import { Addressbook, AddressbookShareCombinedPermissions } from "../Addressbook";
import { JMAPPerson } from "./JMAPPerson";
import { JMAPGroup } from "./JMAPGroup";
import type { JMAPAccount } from "../../Mail/JMAP/JMAPAccount";
import type { PersonUID } from "../../Abstract/PersonUID";
import { checkChangeError } from "../../Mail/JMAP/JMAPError";
import type { TJMAPAddressbook, TJMAPAddressbookRights } from "./TJMAPAddressbook";
import type { TJMAPContact } from "./TJSContact";
import type { TJMAPChangeResponse, TJMAPGetResponse, TID } from "../../Mail/JMAP/TJMAPGeneric";
import { retryOnTransientError } from "../../util/netUtil";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, Collection, SetColl } from "svelte-collections";

export class JMAPAddressbook extends Addressbook {
  readonly protocol: string = "addressbook-jmap";
  canSync: boolean = true;
  declare readonly persons: ArrayColl<JMAPPerson>;
  declare readonly groups: ArrayColl<JMAPGroup>;
  readonly deletions = new Set<string>();
  /** ID in JMAP (because `.id` is the ID our database) */
  jmapID: TID;
  /** Primary addressbook for this account */
  isDefault = false;
  /** isSubscribed - if false, the user doesn't want to see it in the UI */
  shouldShow = true;

  get account(): JMAPAccount {
    assert(this.mainAccount, gt`Address book ${this.name} lost the connection to its account`);
    return this.mainAccount as JMAPAccount;
  }

  newPerson(): JMAPPerson {
    return new JMAPPerson(this);
  }
  newGroup(): JMAPGroup {
    return new JMAPGroup(this);
  }

  get isLoggedIn(): boolean {
    return this.account.isLoggedIn;
  }

  fromJMAP(jmap: TJMAPAddressbook) {
    this.jmapID = sanitize.nonemptystring(jmap.id);
    this.isDefault = sanitize.boolean(jmap.isDefault, false);
    this.shouldShow = sanitize.boolean(jmap.isSubscribed, true);
    if (!this.name || !this.isDefault) { // Default addressbook name = account name, as set by `initFromMainAccount()`
      this.name = sanitize.nonemptystring(jmap.name);
    }
  }

  async listContacts() {
    await super.listContacts();
    await this.account.ensureLoggedIn();

    this.syncState
      ? await this.listChangedPersons()
      : await this.listAllPersons();
  }

  /** Lists all persons in this addressbook. */
  protected async listAllPersons(): Promise<ArrayColl<JMAPPerson>> {
    const batchSize = 200;
    let state: string;
    let hasMore = true;
    let allNewPersons = new ArrayColl<JMAPPerson>();
    for (let i = 0; hasMore; i += batchSize) {
      let { newPersons, updatedPersons, syncState } = await retryOnTransientError(() =>
        this.fetchPersons(i, batchSize + 1));
      state ??= syncState;
      this.persons.addAll(newPersons);
      await this.savePersons(newPersons);
      allNewPersons.addAll(newPersons);
      hasMore = newPersons.length + updatedPersons.length > batchSize;
    }
    if (state) {
      this.account.syncState.set("ContactCard", state);
    }
    this.syncState = state;
    await this.save();
    return allNewPersons;
  }

  protected async fetchPersons(start?: number, limit?: number, options?: any): Promise<UpdateResult<JMAPPerson> & { syncState: string }> {
    console.log("JMAP fetch", limit || start ? `start ${start} limit ${limit}` : "all");
    let listResponse: TJMAPGetResponse<TJMAPContact>;
    let lock = await this.account.stateLock.lock();
    try {
      // <https://www.rfc-editor.org/rfc/rfc8621.html#section-4.4>
      let response = await this.account.makeCombinedCall([
        [
          "ContactCard/query", {
            accountId: this.account.accountID,
            filter: {
              inAddressBook: this.jmapID,
            },
            sort: [
              { property: "created" }
            ],
            position: start,
            limit: limit,
          },
          "list",
        ], [
          "ContactCard/get", {
            accountId: this.account.accountID,
            "#ids": {
              name: "ContactCard/query",
              path: "/ids",
              resultOf: "list",
            },
          },
          "persons",
        ],
      ]);
      listResponse = response["persons"] as TJMAPGetResponse<TJMAPContact>;

      return {
        ...this.parsePersonsList(listResponse.list),
        syncState: listResponse.state,
      };
    } finally {
      lock.release();
    }
  }

  /** Lists all persons in this addressbook that are new or updated since the last fetch. */
  protected async listChangedPersons(): Promise<ArrayColl<JMAPPerson>> {
    if (!this.account.syncState.has("ContactCard")) {
      return await this.listAllPersons();
    }

    try {
      return await this.fetchChangedPersonsForAllAddressbooks();
    } catch (ex) {
      if (ex.code == "cannotCalculateChanges") {
        // Our sync state is too old <https://www.rfc-editor.org/rfc/rfc8620#section-5.2>
        this.account.syncState.delete("ContactCard");
        return await this.listAllPersons();
      }
      throw ex;
    }
  }

  /**
   * Checks new persons for *all* addressbooks in this account,
   * and updates *all* addressbooks.
   * @returns new persons of *this* addressbook
   */
  async fetchChangedPersonsForAllAddressbooks(): Promise<ArrayColl<JMAPPerson>> {
    assert(this.account.syncState.has("ContactCard"), "No sync state");
    let newPersonsOfThisAB = new ArrayColl<JMAPPerson>();
    const kMaxRounds = 1000;
    for (let round = 1; round <= kMaxRounds; round++) {
      let lock = await this.account.stateLock.lock();
      try {
        let sinceState = this.account.syncState.get("ContactCard");
        // <https://www.rfc-editor.org/rfc/rfc8620#section-5.2>
        let response = await this.account.makeCombinedCall([
          [
            "ContactCard/changes", {
              accountId: this.account.accountID,
              sinceState: sinceState,
              maxChanges: 500,
            },
            "changes",
          ], [
            "ContactCard/get", {
              accountId: this.account.accountID,
              "#ids": {
                resultOf: "changes",
                name: "ContactCard/changes",
                path: "/created",
              },
            },
            "added",
          ], [
            "ContactCard/get", {
              accountId: this.account.accountID,
              "#ids": {
                resultOf: "changes",
                name: "ContactCard/changes",
                path: "/updated",
              },
            },
            "changed",
          ],
        ]);

        let changes = response["changes"] as TJMAPChangeResponse<TJMAPContact>;
        let addedResponse = response["added"] as TJMAPGetResponse<TJMAPContact>;
        let changedResponse = response["changed"] as TJMAPGetResponse<TJMAPContact>;

        // Split the responses by addressbook: map Addressbook JMAP ID -> JMAP Contact
        let addedByAB = new Map<string, TJMAPContact[]>();
        let changedByAB = new Map<string, TJMAPContact[]>();
        splitByAddressbook(addedResponse.list, addedByAB);
        splitByAddressbook(changedResponse.list, changedByAB);

        let allAddressbooks = this.account.dependentAccounts().filterOnce(a => a instanceof JMAPAddressbook) as Collection<JMAPAddressbook>;
        for (let addressbook of allAddressbooks) {
          await addressbook.readContactsFromDB();
          if (!addressbook.syncState) {
            continue; // `listContacts()` will list all its persons
          }
          let removed = this.findMovedAway(changedResponse.list, addressbook);
          let addedThisAB = addedByAB.get(addressbook.jmapID);
          let changedThisAB = changedByAB.get(addressbook.jmapID);
          if (!(addedThisAB || changedThisAB ||
                removed.hasItems || changes.destroyed?.length)) {
                continue;
          }
          removed.addAll(await addressbook.parseRemovedPersons(changes.destroyed ?? []));
          // A new item created locally comes back in `created`, so need dup checks
          let addedResult = addressbook.parsePersonsList(addedThisAB ?? []);
          let changedResult = addressbook.parsePersonsList(changedThisAB ?? []);
          addedResult.newPersons.addAll(changedResult.newPersons);

          addressbook.persons.removeAll(removed);
          addressbook.persons.addAll(addedResult.newPersons);
          for (let person of removed) {
            await person.deleteLocally();
          }
          await this.savePersons(changedResult.updatedPersons);
          await this.savePersons(addedResult.newPersons);
          if (this === addressbook) {
            newPersonsOfThisAB.addAll(addedResult.newPersons);
          }
        }

        this.account.syncState.set("ContactCard", changes.newState);
        await this.account.save();
        if (!changes.hasMoreChanges) {
          return newPersonsOfThisAB;
        }
        if (changes.newState == sinceState) {
          break;
        }
      } finally {
        lock.release();
      }
    }
    this.account.errorCallback(new Error("Contact changes: The server keeps reporting more changes. Stopped."));
    return newPersonsOfThisAB;
  }

  protected async parseRemovedPersons(jmapIDs: string[]): Promise<ArrayColl<JMAPPerson>> {
    return new ArrayColl<JMAPPerson>(jmapIDs
      .map(jmapID => this.getPersonByJMAPID(jmapID))
      .filter(ev => ev));
  }

  /**
   * Find `persons` that were moved away from `addressbooks`.
   *
   * To handle copy of the same contact object to a second addressbook, and then deleting it from only one of the addressbooks,
   * we need to check *all* addressbooks for *every* changed contact, even if the addressbook didn't change, because
   * JMAP doesn't tell us about moves or removals of the second copy. :-(
   * @return removed contacts. It's the caller's obligation to remove them from the addressbook
   */
  protected findMovedAway(persons: TJMAPContact[], addressbook: JMAPAddressbook): SetColl<JMAPPerson> {
    let removed = new SetColl<JMAPPerson>();
    for (let person of persons) {
      let existing = addressbook.getPersonByJMAPID(person.id);
      // added persons are handled by `addressbook.parsePersonsList(changedThisAB...`
      if (existing && !person.addressBookIds[addressbook.jmapID]) {
        removed.add(existing);
      }
    }
    return removed;
  }

  protected parsePersonsList(persons: TJMAPContact[], checkUpdates = true): UpdateResult<JMAPPerson> {
    let newPersons = new ArrayColl<JMAPPerson>();
    let updatedPersons = new ArrayColl<JMAPPerson>();
    for (let json of persons) {
      try {
        let id = sanitize.nonemptystring(json.id);
        if (this.deletions.has(id)) {
          continue;
        }
        let person = checkUpdates && this.getPersonByJMAPID(id);
        if (person) {
          person.fromJMAP(json);
          updatedPersons.add(person);
        } else {
          person = this.newPerson();
          person.fromJMAP(json);
          newPersons.add(person);
        }
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    return { newPersons, updatedPersons };
  }

  protected async savePersons(persons: Collection<JMAPPerson>) {
    for (let person of persons) {
      await person.saveLocally();
    }
  }

  protected getPersonByJMAPID(jmapID: string): JMAPPerson | undefined {
    return this.persons.find(p => p.jmapID == jmapID);
  }

  protected getGroupByJMAPID(jmapID: string): JMAPGroup | undefined {
    return this.groups.find(p => p.jmapID == jmapID);
  }

  get sharePermissionLevels(): AddressbookShareCombinedPermissions[] {
    return [
      AddressbookShareCombinedPermissions.Read,
      AddressbookShareCombinedPermissions.Modify,
    ];
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    let response = await this.account.makeSingleCall("AddressBook/get", {
      accountId: this.account.accountID,
      ids: [this.jmapID],
      properties: ["shareWith"],
    }) as TJMAPGetResponse<TJMAPAddressbook>;
    return await this.account.getPrincipals(Object.keys(response.list[0]?.shareWith ?? {}));
  }

  async deleteSharedPerson(person: PersonUID) {
    await this.setSharedPerson(person, null);
  }

  async addSharedPerson(person: PersonUID, access: AddressbookShareCombinedPermissions) {
    await this.setSharedPerson(person, {
      mayRead: true,
      mayWrite: access == AddressbookShareCombinedPermissions.Modify,
      mayShare: false,
      mayDelete: false,
    });
  }

  protected async setSharedPerson(person: PersonUID, rights: TJMAPAddressbookRights | null) {
    let principalID = (await this.account.findPrincipal(person))?.id;
    assert(principalID, gt`You have no access to the account of ${person.emailAddress}`);
    let response = await this.account.makeSingleCall("AddressBook/set", {
      accountId: this.account.accountID,
      update: {
        [this.jmapID]: { [`shareWith/${principalID}`]: rights },
      },
    }) as TJMAPChangeResponse<TJMAPAddressbook>;
    checkChangeError(response);
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.jmapID = sanitize.alphanumdash(json.jmapID);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.jmapID = this.jmapID;
    return json;
  }
}

type UpdateResult<T> = { newPersons: ArrayColl<T>, updatedPersons: ArrayColl<T> }

function splitByAddressbook(list: TJMAPContact[], map: Map<string, TJMAPContact[]>) {
  for (let resp of list) {
    for (let addressbookID in resp.addressBookIds) {
      let list = map.get(addressbookID);
      if (!list) {
        list = [];
        map.set(addressbookID, list);
      }
      list.push(resp);
    }
  }
}
