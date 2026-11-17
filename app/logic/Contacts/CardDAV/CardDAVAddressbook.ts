import { Addressbook } from "../Addressbook";
import { CardDAVPerson } from "./CardDAVPerson";
import { CardDAVGroup } from "./CardDAVGroup";
import { AuthMethod, type Account } from "../../Abstract/Account";
import { OAuth2 } from "../../Auth/OAuth2";
import { newAddressbookForProtocol } from "../AccountsList/Addressbooks";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { Lock } from "../../util/flow/Lock";
import { RunOnce } from "../../util/flow/RunOnce";
import { NotReached, UserError, assert, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, Collection } from "svelte-collections";
import type { DAVClient, DAVAddressBook, DAVObject } from "tsdav";

export class CardDAVAddressbook extends Addressbook {
  readonly protocol: string = "carddav";
  canSync: boolean = true;
  declare readonly persons: ArrayColl<CardDAVPerson>;
  declare readonly groups: ArrayColl<CardDAVGroup>;
  /** URL of the specific addressbook - a CalDAV account can contain multiple addressbooks. */
  addressbookURL: URLString;
  ctag: string | null = null;
  client: DAVClient;
  /** The OAuth2 access token that `client` authenticates with */
  protected clientAccessToken: string | null = null;
  protected readonly syncLock = new Lock();
  protected readonly loginRunOnce = new RunOnce();

  newPerson(): CardDAVPerson {
    return new CardDAVPerson(this);
  }
  newGroup(): CardDAVGroup {
    return new CardDAVGroup(this);
  }

  get isLoggedIn(): boolean {
    if (this.authMethod == AuthMethod.OAuth2) {
      if (this.isDependentAccount) {
        return this.mainAccount.isLoggedIn;
      }
      return this.oAuth2.isLoggedIn;
    } else if (this.authMethod == AuthMethod.Password) {
      return !!this.password;
    } else {
      throw new NotReached(gt`Unknown authentication method`);
    }
  }

  async login(interactive: boolean) {
    await this.loginRunOnce.runOnce(async () => {
      let useOAuth2 = this.authMethod == AuthMethod.OAuth2;
      let usePassword = this.authMethod == AuthMethod.Password;
      let oAuth2 = this.oAuth2 ?? this.mainAccount?.oAuth2;
      if (useOAuth2) {
        if (this.isDependentAccount) {
          await this.mainAccount.login(interactive);
        } else {
          assert(oAuth2, gt`Need OAuth2 configuration`);
          if (!oAuth2.isLoggedIn) {
            await oAuth2.login(interactive);
          }
        }
      }
      assert(usePassword || useOAuth2, gt`Unknown authentication method`);
      if (this.client && (!useOAuth2 || this.clientAccessToken == oAuth2.accessToken)) {
        return; // already logged in. The client caches the auth headers, so re-create it once the access token changed.
      }
      if (!URL.canParse(this.url)) {
        throw new UserError(gt`Please enter the server URL, e.g. https://dav.example.com/`);
      }
      let options = {
        serverUrl: this.url,
        authMethod: useOAuth2 ? "Bearer" : "Basic",
        credentials: useOAuth2 ? {
          accessToken: oAuth2.accessToken,
        } : {
          username: this.username,
          password: usePassword ? this.password : undefined,
        },
        defaultAccountType: "carddav",
      };
      this.clientAccessToken = useOAuth2 ? oAuth2.accessToken : null;
      this.client = await appGlobal.remoteApp.createTSDAVClient(options);
      await this.client.login();
    });
  }

  async listAddressbooks(): Promise<Collection<DAVAddressBook>> {
    await this.login(false);
    let lock = await this.syncLock.lock();
    try {
      return new ArrayColl(await this.client.fetchAddressBooks());
    } finally {
      lock.release();
    }
  }

  async listContacts() {
    await super.listContacts();
    await this.sync();
    await this.save();
  }

  get davAddressbook(): DAVAddressBook {
    let davAB = {} as DAVAddressBook;
    davAB.url = this.addressbookURL;
    davAB.ctag = this.ctag;
    davAB.syncToken = this.syncState;
    davAB.displayName = this.name;
    return davAB;
  };

  protected async fetchAll() {
    let lock = await this.syncLock.lock();
    try {
      this.persons.clear();
      this.groups.clear();
      let vCardEntries = await this.client.fetchVCards({ addressBook: this.davAddressbook });
      for (let vCardEntry of vCardEntries) {
        await this.addPerson(vCardEntry);
      }
    } finally {
      lock.release();
    }
  }

  protected async sync() {
    let lock = await this.syncLock.lock();
    try {
      await this.login(false);
      let localObjects = this.persons.contents.map(e => ({
        url: e.url,
        etag: e.etag,
        data: undefined, // unused by function, and expensive to calculate
        id: undefined, // unused by function, and not passed by iCalEntry
      }));
      let syncResponse = await this.client.smartCollectionSync({
        collection: {
          url: this.addressbookURL,
          ctag: this.ctag,
          syncToken: this.syncState,
          objects: localObjects,
          objectMultiGet: (...args) => this.client.addressBookMultiGet(...args),
        },
        method: 'webdav',
        detailedResult: true,
      });
      let { created, updated, deleted } = syncResponse.objects;
      for (let vCardEntry of created) {
        await this.addPerson(vCardEntry);
      }
      for (let vCardEntry of updated) {
        try {
          let existing = this.getPersonByURL(vCardEntry.url);
          if (existing) {
            existing.fromDAVObject(vCardEntry);
            await existing.saveLocally();
          } else {
            await this.addPerson(vCardEntry);
          }
        } catch (ex) {
          this.errorCallback(ex);
        }
      }
      for (let vCardEntry of deleted) {
        try {
          let existing = this.getPersonByURL(vCardEntry.url);
          if (existing) {
            await existing.deleteLocally();
          }
        } catch (ex) {
          this.errorCallback(ex);
        }
      }

      this.ctag = syncResponse.ctag;
      this.syncState = syncResponse.syncToken;
    } finally {
      lock.release();
    }
  }

  protected async addPerson(vCardEntry: DAVObject) {
    try {
      let person = this.newPerson();
      person.fromDAVObject(vCardEntry);
      this.persons.add(person);
      await person.saveLocally();
    } catch (ex) {
      this.errorCallback(ex);
    }
  }

  getPersonByURL(relativeURL: URLString): CardDAVPerson | undefined {
    let url = new URL(relativeURL, this.addressbookURL).href;
    return this.persons.find(p => p.url == url);
  }

  initFromMainAccount(main: Account): void {
    super.initFromMainAccount(main);
    this.authMethod = main.authMethod;
    this.username = main.username;
    this.password = main.password;
  }

  /**
   * Lists the addressbooks/calendars that are not set up yet.
   *
   * Note: Only during setup, CardDAV/CalDAV special case: The config account has
   * no addressbookURL and is therefore a dummy, and this function returns all the addressbooks.
   * If you are in settings (not setup), this function lists the addressbooks are that not set up yet.
   */
  async listPossibleSubAccounts(): Promise<ArrayColl<CardDAVAddressbook>> {
    assert(!this.isDependentAccount, "Call this on the main account");
    let addressbooks = await this.listAddressbooks();
    let newAddressbooks = addressbooks.filterOnce(ab =>
      this.addressbookURL != ab.url &&
      !this.dependentAccounts().find(sub => sub instanceof CardDAVAddressbook && sub.addressbookURL == ab.url));
    let newAccounts = new ArrayColl<CardDAVAddressbook>();
    let i = 0;
    for (let newAB of newAddressbooks) {
      let account = newAddressbookForProtocol(this.protocol) as CardDAVAddressbook; // also sets up storage etc.
      account.initFromMainAccount(this);
      account.addressbookURL = sanitize.url(newAB.url);
      account.name = this.name + " " + sanitize.nonemptylabel(newAB.displayName as string, "" + ++i);
      account.ctag = sanitize.string(newAB.ctag, null);
      account.syncState = sanitize.string(newAB.syncToken, null);
      newAccounts.add(account);
    }
    return newAccounts;
  }

  get mayHaveSubAccounts() {
    return !this.isDependentAccount;
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.addressbookURL = sanitize.url(json.addressbookURL);
    this.ctag = sanitize.string(json.ctag, null);
    if (json.oAuth2) {
      this.oAuth2 = OAuth2.fromConfigJSON(json.oAuth2, this);
      this.oAuth2.subscribe(() => this.notifyObservers());
    }
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.addressbookURL = this.addressbookURL;
    json.ctag = this.ctag;
    json.oAuth2 = this.oAuth2?.toConfigJSON();
    return json;
  }
}
