import { Addressbook } from "../Addressbook";
import { AddonPerson } from "./AddonPerson";
import { AuthMethod } from "../../Abstract/Account";
import { AddonConnection } from "../../Addons/AddonConnection";
import { appGlobal } from "../../app";
import { Lock } from "../../util/flow/Lock";
import type { ArrayColl } from "svelte-collections";

/** An addressbook whose protocol an addon implements.
 * The addon does only the server talk, with contacts in vCard format.
 * They are parsed, stored and shown like those of other protocols. */
export class AddonAddressbook extends Addressbook {
  readonly protocol: string;
  readonly connection = new AddonConnection(this, appGlobal.addressbooks);
  canSync = true;
  declare readonly persons: ArrayColl<AddonPerson>;
  /** Opaque, from the addon */
  declare syncState: string | null;
  protected readonly syncLock = new Lock();

  /** @param protocol `AddonProtocol.accountProtocol()` */
  constructor(protocol: string) {
    super();
    this.protocol = protocol;
    this.authMethod = AuthMethod.Password;
  }

  newPerson(): AddonPerson {
    return new AddonPerson(this);
  }

  get isLoggedIn(): boolean {
    return this.connection.isLoggedIn;
  }

  async login(interactive: boolean): Promise<void> {
    await super.login(interactive);
    await this.connection.login();
  }

  async verifyLogin(): Promise<void> {
    await this.connection.verifyLogin();
  }

  async disconnect(): Promise<void> {
    this.connection.disconnect();
  }

  /** Reads the contacts that we have, then gets the new, changed and removed contacts from the addon, in chunks */
  async listContacts(): Promise<void> {
    await super.listContacts();
    let lock = await this.syncLock.lock();
    try {
      await this.connection.listChanges("listContacts", [], this.syncState, "contacts",
        async (contacts, removed, syncState) => await this.applyContactList(contacts, removed, syncState));
    } finally {
      lock.release();
    }
  }

  /** Stores one checked chunk from the addon */
  protected async applyContactList(contacts: any[], removed: unknown[], syncState: string): Promise<void> {
    const kMaxVCardLength = 1024 * 1024;
    let byID = new Map<string, AddonPerson>();
    for (let person of this.persons) {
      if (person.serverID) {
        byID.set(person.serverID, person);
      }
    }
    for (let json of contacts) {
      try {
        let id = this.connection.checkID(json?.id);
        if (typeof json.vcard != "string" || json.vcard.length > kMaxVCardLength) {
          throw new Error(`${this.name}: The addon gave no vCard for the contact ${id}, or one larger than 1 MB`);
        }
        let person = byID.get(id) ?? this.newPerson();
        person.fromAddon(id, json.vcard);
        byID.set(id, person);
        await person.saveLocally();
      } catch (ex) {
        this.dataError(ex);
      }
    }
    for (let id of removed) {
      let person = typeof id == "string" ? byID.get(id) : undefined;
      if (!person) {
        continue;
      }
      try {
        await person.deleteLocally();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    this.syncState = syncState;
    await this.save();
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.syncState = typeof json.syncState == "string" ? json.syncState : null;
    this.connection.fromConfigJSON(json);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    this.connection.toConfigJSON(json);
    return json;
  }
}
