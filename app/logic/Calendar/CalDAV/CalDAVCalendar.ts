import { Calendar } from "../Calendar";
import type { Participant } from "../Participant";
import type { FreeBusyEvent } from "../FreeBusyEvent";
import { CalDAVEvent } from "./CalDAVEvent";
import { AuthMethod, type Account } from "../../Abstract/Account";
import { OAuth2 } from "../../Auth/OAuth2";
import { newCalendarForProtocol } from "../AccountsList/Calendars";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { Lock } from "../../util/flow/Lock";
import { RunOnce } from "../../util/flow/RunOnce";
import { NotReached, UserError, assert, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, Collection } from "svelte-collections";
import type { DAVClient, DAVCalendar, DAVObject } from "tsdav";

export class CalDAVCalendar extends Calendar {
  readonly protocol: string = "caldav";
  declare readonly events: ArrayColl<CalDAVEvent>;
  /** URL of the specific calendar - a CalDAV account can contain multiple calendars */
  calendarURL: URLString;
  ctag: string | null = null;
  client: DAVClient;
  /** The OAuth2 access token that `client` authenticates with */
  protected clientAccessToken: string | null = null;
  protected readonly syncLock = new Lock();
  protected readonly loginRunOnce = new RunOnce();

  newEvent(parentEvent?: CalDAVEvent): CalDAVEvent {
    return new CalDAVEvent(this, parentEvent);
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
        defaultAccountType: "caldav",
      };
      this.clientAccessToken = useOAuth2 ? oAuth2.accessToken : null;
      this.client = await appGlobal.remoteApp.createTSDAVClient(options);
      await this.client.login();
    });
  }

  get davCalendar(): DAVCalendar {
    let davAB = {} as DAVCalendar;
    davAB.url = this.calendarURL;
    davAB.ctag = this.ctag;
    davAB.syncToken = this.syncState;
    davAB.displayName = this.name;
    return davAB;
  };

  async arePersonsFree(participants: Participant[], from: Date, to: Date): Promise<{ participant: Participant, availability?: FreeBusyEvent[] }[]> {
    return [];
  }

  async listCalendars(): Promise<Collection<DAVCalendar>> {
    await this.login(false);
    let lock = await this.syncLock.lock();
    try {
      return new ArrayColl(await this.client.fetchCalendars());
    } finally {
      lock.release();
    }
  }

  protected async listEventsFromServer() {
    await this.sync();
    await this.save();
  }

  protected async fetchAll() {
    let lock = await this.syncLock.lock();
    try {
      this.events.clear();
      let iCalEntries = await this.client.fetchCalendarObjects({ calendar: this.davCalendar });
      for (let iCalEntry of iCalEntries) {
        await this.addEvent(iCalEntry);
      }
    } finally {
      lock.release();
    }
}

  protected async sync() {
    let lock = await this.syncLock.lock();
    try {
      await this.login(false);
      /* For multiple calendars:
      let { created, updated, deleted } = await this.client.syncCalendars({
        oldCalendars: [this.davCalendar],
        detailedResult: true,
      });
      if (!updated?.length || !updated.includes(this.davCalendar)) {
        return;
      }*/
      let localObjects = this.events.contents.map(e => ({
        url: e.url,
        etag: e.etag,
        data: undefined, // unused by function, and expensive to calculate
        id: undefined, // unused by function, and not passed by iCalEntry
      }));
      let syncResponse = await this.client.smartCollectionSync({
        collection: {
          url: this.calendarURL,
          ctag: this.ctag,
          syncToken: this.syncState,
          objects: localObjects,
          objectMultiGet: (...args) => this.client.calendarMultiGet(...args),
        },
        method: 'webdav',
        detailedResult: true,
      });
      let { created, updated, deleted } = syncResponse.objects;
      for (let iCalEntry of created) {
        await this.addEvent(iCalEntry);
      }
      for (let iCalEntry of updated) {
        try {
          let existing = this.getEventByURL(iCalEntry.url);
          if (existing) {
            existing.fromDAVObject(iCalEntry);
            await existing.saveLocally();
            await existing.updateExceptions();
          } else {
            await this.addEvent(iCalEntry);
          }
        } catch (ex) {
          this.errorCallback(ex);
        }
      }
      for (let iCalEntry of deleted) {
        try {
          let existing = this.getEventByURL(iCalEntry.url);
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

  protected async addEvent(iCalEntry: DAVObject) {
    try {
      let event = this.newEvent();
      let isEvent = event.fromDAVObject(iCalEntry);
      if (!isEvent) {
        return;
      }
      this.events.add(event);
      await event.saveLocally();
      await event.updateExceptions();
    } catch (ex) {
      this.errorCallback(ex);
    }
  }

  getEventByURL(relativeURL: URLString): CalDAVEvent | undefined {
    let url = new URL(relativeURL, this.calendarURL).href;
    return this.events.find(e => e.url == url);
  }

  initFromMainAccount(main: Account): void {
    super.initFromMainAccount(main);
    this.authMethod = main.authMethod;
    this.username = main.username;
    this.password = main.password;
  }

  /**
   * Lists the calendars that are not set up yet.
   *
   * Note: Only during setup, CardDAV/CalDAV special case: The config account has
   * no calendarURL and is therefore a dummy, and this function returns all the calendars.
   * If you are in settings (not setup), this function lists the calendars are that not set up yet.
   */
  async listPossibleSubAccounts(): Promise<ArrayColl<CalDAVCalendar>> {
    assert(!this.isDependentAccount, "Call this on the main account");
    let calendars = await this.listCalendars();
    let newCalendars = calendars.filterOnce(ab =>
      this.calendarURL != ab.url &&
      !this.dependentAccounts().find(sub => sub instanceof CalDAVCalendar && sub.calendarURL == ab.url));
    let newAccounts = new ArrayColl<CalDAVCalendar>();
    let i = 0;
    for (let newCal of newCalendars) {
      let account = newCalendarForProtocol(this.protocol) as CalDAVCalendar; // also sets up storage etc.
      account.initFromMainAccount(this);
      account.calendarURL = sanitize.url(newCal.url);
      account.name = this.name + " " + sanitize.nonemptylabel(newCal.displayName as string, "" + ++i);
      account.ctag = sanitize.string(newCal.ctag, null);
      account.syncState = sanitize.string(newCal.syncToken, null);
      newAccounts.add(account);
    }
    return newAccounts;
  }

  get mayHaveSubAccounts() {
    return !this.isDependentAccount;
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.calendarURL = sanitize.url(json.calendarURL);
    this.ctag = sanitize.string(json.ctag, null);
    if (json.oAuth2) {
      this.oAuth2 = OAuth2.fromConfigJSON(json.oAuth2, this);
      this.oAuth2.subscribe(() => this.notifyObservers());
    }
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.calendarURL = this.calendarURL;
    json.ctag = this.ctag;
    json.oAuth2 = this.oAuth2?.toConfigJSON();
    return json;
  }
}
