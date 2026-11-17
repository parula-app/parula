import { ContactBase } from './Contact';
import type { Person } from './Person';
import type { Addressbook } from '../Contacts/Addressbook';
import { notifyChangedProperty } from '../util/Observable';
import { SetColl } from 'svelte-collections';

export class Group extends ContactBase {
  @notifyChangedProperty
  description = "";
  readonly participants = new SetColl<Person>();

  /**
   * Saves group to the server and to the database.
   */
  async save() {
    await super.save();
    try {
      await this.saveToServer();
    } finally {
      // Why locally after server: Exchange assigns item ID etc., so need to store it locally.
      // Even a failed save may have created the group, and losing its ID
      // would create a second one on the next save.
      await this.saveLocally();
    }
  }

  /**
   * Saves group locally to the database.
   */
  async saveLocally() {
    await this.addressbook.storage.saveGroup(this);
  }

  async saveToServer(): Promise<void> {
    // nothing to do for local groups
  }

  /**
   * Deletes the group on the server and from the database.
   */
  async deleteIt() {
    await this.deleteLocally();
    await this.deleteFromServer();
  }

  /**
   * Deletes the group locally from the database.
   */
  async deleteLocally() {
    if (!this.addressbook) {
      return;
    }
    this.addressbook.groups.remove(this);
    if (this.dbID) {
      await this.addressbook.storage.deleteGroup(this);
    }
  }

  async deleteFromServer(): Promise<void> {
    // nothing to do for local groups
  }

  /** Group class needs to match account class, so need to clone. */
  async moveToAddressbook(newAddressbook: Addressbook): Promise<void> {
    if (this.addressbook == newAddressbook || !newAddressbook) {
      return;
    }
    let newGroup = newAddressbook.newGroup();
    if (Object.getPrototypeOf(this) == Object.getPrototypeOf(newGroup)) {
      this.addressbook?.groups.remove(this);
      this.addressbook = newAddressbook;
      newAddressbook.groups.add(this);
      await this.save();
      return;
    }
    Object.assign(newGroup, this);
    newGroup.addressbook = newAddressbook;
    this.addressbook?.groups.remove(this);
    newAddressbook.groups.add(newGroup);
    await this.deleteIt();
    await newGroup.save();
  }
}
